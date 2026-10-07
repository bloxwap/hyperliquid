/** Optional bounded microbatching for independent order callers. @module */
import { HyperliquidError } from "../_base.ts";
import { ApiRequestError } from "../api/_errors.ts";
import type { ExchangeConfig } from "../api/exchange/_methods/_base/_config.ts";
import {
  buildOrder,
  type OrderOptions,
  type OrderParameters,
  type OrderResponse,
  type OrderSuccessResponse,
} from "../api/exchange/_methods/order.ts";
import { resolveRuntime, type Runtime, type TimerHandle } from "../transport/runtime.ts";
import { canonicalAction, immutableCopy } from "./_canonical.ts";
import { type ActionOptions, executeAction } from "./execution.ts";

/** Per-item server outcome. Transport/top-level failures reject the enqueue promise. */
export type OrderOutcome = OrderResponse["response"]["data"]["statuses"][number];

function isOrderOutcome(value: unknown): value is OrderOutcome {
  if (value === "waitingForFill" || value === "waitingForTrigger") return true;
  if (!value || typeof value !== "object") return false;
  if ("error" in value) return typeof value.error === "string";
  if ("resting" in value) {
    const resting = value.resting;
    return !!resting && typeof resting === "object" && "oid" in resting && Number.isSafeInteger(resting.oid);
  }
  if ("filled" in value) {
    const filled = value.filled;
    return (
      !!filled &&
      typeof filled === "object" &&
      "oid" in filled &&
      Number.isSafeInteger(filled.oid) &&
      "totalSz" in filled &&
      typeof filled.totalSz === "string" &&
      "avgPx" in filled &&
      typeof filled.avgPx === "string"
    );
  }
  return false;
}

/**
 * Order class for partitioning. ALO stays apart from IOC/GTC to keep its prioritization; under
 * priority grouping the exchange requires every order to be IOC or every order a non-reduce-only
 * ALO, so the class also carries the time-in-force and reduce-only flag.
 */
function orderClass(order: OrderParameters["orders"][number], priority: boolean): string {
  const tif = "limit" in order.t ? order.t.limit.tif : "trigger";
  if (priority) return `${tif}:${order.r}`;
  return tif === "Alo" ? "alo" : "other";
}

/** Queue limits and scheduling. */
export interface OrderBatcherOptions {
  /** Maximum queued plus in-flight orders. Default: 1000. */
  maxQueueSize?: number;
  /** Maximum orders per request. Default: 100. */
  maxBatchSize?: number;
  /** Delay before automatically flushing queued orders. Default: 1 ms. */
  flushIntervalMs?: number;
  /** Isolated scheduler and wall clock. */
  runtime?: Partial<Runtime>;
}
/** Grouping and signing options must match for orders to share a batch. */
export type EnqueueOrderOptions = Pick<OrderParameters, "grouping" | "builder"> & Omit<OrderOptions, "skipValidation">;
interface Entry {
  key: string;
  params: OrderParameters;
  options: Omit<ActionOptions, "signal">;
  resolve: (outcome: OrderOutcome) => void;
  reject: (reason: unknown) => void;
  detach: () => void;
  dispatched: boolean;
  settled: boolean;
}

/** Explicit lifecycle for batching; callers may flush immediately or close with drain/abort. */
export class OrderBatcher {
  private readonly _runtime: Runtime;
  private readonly _maxQueue: number;
  private readonly _maxBatch: number;
  private readonly _interval: number;
  private readonly _config: ExchangeConfig;
  private readonly _queue: Entry[] = [];
  /** Compatible queued counts avoid a full backlog scan on every enqueue. */
  private readonly _queuedByKey = new Map<string, number>();
  private readonly _active = new Set<Entry>();
  private readonly _requests = new Set<Promise<void>>();
  private readonly _abort = new AbortController();
  private _timer?: TimerHandle;
  private _closed = false;
  private _draining?: Promise<void>;

  constructor(config: ExchangeConfig, options?: OrderBatcherOptions) {
    this._config = { ...config };
    this._runtime = resolveRuntime(options?.runtime);
    this._maxQueue = options?.maxQueueSize ?? 1000;
    this._maxBatch = options?.maxBatchSize ?? 100;
    this._interval = options?.flushIntervalMs ?? 1;
    if (
      !Number.isSafeInteger(this._maxQueue) ||
      this._maxQueue < 1 ||
      !Number.isSafeInteger(this._maxBatch) ||
      this._maxBatch < 1 ||
      !Number.isFinite(this._interval) ||
      this._interval < 0 ||
      this._interval > 2_147_483_647
    ) {
      throw new RangeError("Batch limits must be positive integers and flushIntervalMs a finite timer delay");
    }
  }

  /** Outstanding queued and dispatched orders, including callers awaiting a response. */
  get pending(): number {
    return this._active.size;
  }

  /** Queue one raw-asset order. Cancelling after dispatch only stops this caller waiting. */
  enqueue(input: OrderParameters["orders"][number], options?: EnqueueOrderOptions): Promise<OrderOutcome> {
    if (this._closed) return Promise.reject(new HyperliquidError("Order batcher is closed"));
    if (options?.signal?.aborted) return Promise.reject(options.signal.reason);
    if (this.pending >= this._maxQueue) return Promise.reject(new HyperliquidError("Order batcher queue is full"));
    try {
      // Validated per caller, so one malformed order cannot fail its batch.
      const params = buildOrder({ orders: [input], grouping: options?.grouping, builder: options?.builder })
        .payload as OrderParameters;
      const vaultAddress = options?.vaultAddress ?? this._config.defaultVaultAddress;
      const expiresAfter = options?.expiresAfter ?? this._config.defaultExpiresAfter;
      // Dynamic defaults are resolved per actual batch by the execution core.
      const signingOptions = immutableCopy({
        vaultAddress,
        expiresAfter: typeof expiresAfter === "function" ? undefined : expiresAfter,
      });
      const key = JSON.stringify([
        params.grouping,
        params.builder,
        signingOptions,
        orderClass(params.orders[0], typeof params.grouping === "object"),
      ]);
      return new Promise<OrderOutcome>((resolve, reject) => {
        const entry: Entry = {
          key,
          params,
          options: signingOptions,
          resolve,
          reject,
          detach: () => {},
          dispatched: false,
          settled: false,
        };
        if (options?.signal) {
          const signal = options.signal;
          const onAbort = (): void => {
            if (entry.dispatched) {
              // Keep capacity occupied until the actual batch settles: server acceptance is unknown.
              this._settle(entry, undefined, signal.reason, true);
            } else {
              const index = this._queue.indexOf(entry);
              if (index >= 0) {
                this._queue.splice(index, 1);
                this._decrementQueued(entry.key);
              }
              this._settle(entry, undefined, signal.reason);
              if (this._queue.length === 0) this._clearTimer();
            }
          };
          signal.addEventListener("abort", onAbort, { once: true });
          entry.detach = (): void => signal.removeEventListener("abort", onAbort);
        }
        this._active.add(entry);
        this._queue.push(entry);
        const queued = (this._queuedByKey.get(key) ?? 0) + 1;
        this._queuedByKey.set(key, queued);
        if (queued >= this._maxBatch) this._dispatch();
        else this._armTimer();
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** Immediately dispatch queued orders and wait for all batches outstanding at invocation. */
  async flush(): Promise<void> {
    this._clearTimer();
    this._dispatch();
    await Promise.all([...this._requests]);
  }

  /** Stop accepting orders; drain by default, or abort waiting callers without implying server cancellation. */
  close(options?: { drain?: boolean }): Promise<void> {
    this._closed = true;
    this._clearTimer();
    if (options?.drain === false) {
      const error = new HyperliquidError("Order batcher closed; dispatched orders may already be accepted");
      this._abort.abort(error);
      this._queue.length = 0;
      this._queuedByKey.clear();
      for (const entry of this._active) this._settle(entry, undefined, error);
      return Promise.resolve();
    }
    return (this._draining ??= this.flush());
  }

  private _clearTimer(): void {
    this._runtime.clearTimeout(this._timer);
    this._timer = undefined;
  }
  private _decrementQueued(key: string): void {
    const remaining = this._queuedByKey.get(key)! - 1;
    if (remaining === 0) this._queuedByKey.delete(key);
    else this._queuedByKey.set(key, remaining);
  }
  private _armTimer(): void {
    if (this._timer === undefined && this._queue.length > 0)
      this._timer = this._runtime.setTimeout(() => {
        this._timer = undefined;
        this._dispatch();
      }, this._interval);
  }
  private _settle(entry: Entry, outcome?: OrderOutcome, error?: unknown, retainCapacity = false): void {
    if (!retainCapacity) this._active.delete(entry);
    if (entry.settled) return;
    entry.settled = true;
    entry.detach();
    if (outcome !== undefined) entry.resolve(outcome);
    else entry.reject(error);
  }
  private _dispatch(): void {
    this._clearTimer();
    this._queuedByKey.clear();
    const groups = new Map<string, Entry[]>();
    for (const entry of this._queue.splice(0)) {
      let group = groups.get(entry.key);
      if (!group || group.length === this._maxBatch) {
        if (group) this._post(group);
        group = [];
        groups.set(entry.key, group);
      }
      group.push(entry);
    }
    for (const group of groups.values()) this._post(group);
  }
  private _post(entries: Entry[]): void {
    for (const entry of entries) entry.dispatched = true;
    const task = this._send(entries).finally(() => this._requests.delete(task));
    this._requests.add(task);
  }
  private async _send(entries: Entry[]): Promise<void> {
    try {
      const first = entries[0];
      const expires = first.options.expiresAfter;
      if (expires !== undefined && Number(expires) <= this._runtime.now())
        throw new HyperliquidError("Queued order expired before dispatch");
      // Every order was validated and canonicalized at enqueue and the partition key fixes the
      // shared fields, so the batch is assembled without validating each order a second time.
      const action = canonicalAction<OrderSuccessResponse>(
        {
          type: "order",
          orders: entries.map((entry) => entry.params.orders[0]),
          grouping: first.params.grouping,
          ...(first.params.builder ? { builder: first.params.builder } : {}),
        },
        { kind: "l1" },
      );
      let response: unknown;
      try {
        response = await executeAction(this._config, action, { ...first.options, signal: this._abort.signal });
      } catch (error) {
        // ApiRequestError retains the full raw response, including successful batch items.
        if (!(error instanceof ApiRequestError)) throw error;
        response = error.response;
      }
      const envelope = response as OrderResponse;
      const statuses = envelope?.response?.data?.statuses;
      if (
        envelope?.status !== "ok" ||
        envelope.response.type !== "order" ||
        !Array.isArray(statuses) ||
        statuses.length !== entries.length ||
        !statuses.every(isOrderOutcome)
      ) {
        throw new ApiRequestError(response, "Order batch rejected or response cardinality mismatch");
      }
      for (let i = 0; i < entries.length; i++) this._settle(entries[i], statuses[i]);
    } catch (error) {
      for (const entry of entries) this._settle(entry, undefined, error);
    }
  }
}

/** Construct a batcher without changing the immediate-dispatch behavior of ExchangeClient.order. */
export function createOrderBatcher(config: ExchangeConfig, options?: OrderBatcherOptions): OrderBatcher {
  return new OrderBatcher(config, options);
}
