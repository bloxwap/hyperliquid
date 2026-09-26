/**
 * Offline tests for `SubscriptionClient.unsubscribeAll()` and the tracking behind it: the client
 * registers every confirmed subscription on its transport's shared tracker, drops handles that are
 * unsubscribed or fail, retires in-flight subscribes that confirm after a teardown, and guarantees
 * a `failureSignal` on every handle it returns.
 * @module
 */

import { describe, expect, mock, test } from "bun:test";
import { type ISubscription, SubscriptionClient, TransportError } from "@bloxwap/hyperliquid";
import { unsubscribeAll } from "@bloxwap/hyperliquid/api/subscription";
import { type MockSubscribeOptions, MockSubscriptionTransport } from "./_mockTransport.ts";

/**
 * Mock transport whose subscribe promises stay pending until explicitly settled, for the
 * in-flight semantics of `unsubscribeAll()`.
 */
class PendingSubscriptionTransport extends MockSubscriptionTransport {
  private readonly _resolvers: ((sub: ISubscription) => void)[] = [];
  private readonly _rejecters: ((error: unknown) => void)[] = [];

  override subscribe<T>(
    channel: string,
    payload: unknown,
    listener: (data: CustomEvent<T>) => void,
    options?: MockSubscribeOptions,
  ): Promise<ISubscription> {
    void super.subscribe(channel, payload, listener, options); // records the call
    return new Promise((resolve, reject) => {
      this._resolvers.push(resolve);
      this._rejecters.push(reject);
    });
  }

  /** Resolves the oldest pending subscribe with a counted unsubscribe handle. */
  confirmNext(): void {
    const resolve = this._resolvers.shift();
    this._rejecters.shift();
    if (resolve === undefined) throw new Error("no pending subscribe");
    resolve({
      unsubscribe: () => {
        this.unsubscribeCalls++;
        return Promise.resolve();
      },
    });
  }

  /** Rejects the oldest pending subscribe. */
  failNext(error: unknown): void {
    this._resolvers.shift();
    const reject = this._rejecters.shift();
    if (reject === undefined) throw new Error("no pending subscribe");
    reject(error);
  }
}

describe("SubscriptionClient.unsubscribeAll", () => {
  test("unsubscribes every confirmed subscription and clears the registry", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });

    await client.allMids(() => {});
    await client.allMids(() => {}); // a second listener on the same channel
    await client.l2Book({ coin: "ETH" }, () => {});

    await client.unsubscribeAll();
    expect(transport.unsubscribeCalls).toBe(3);

    await client.unsubscribeAll(); // the registry was cleared: nothing left to unsubscribe
    expect(transport.unsubscribeCalls).toBe(3);
  });

  test("handles unsubscribed individually are not revisited", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });

    const first = await client.allMids(() => {});
    await client.allMids(() => {});
    await first.unsubscribe();
    expect(transport.unsubscribeCalls).toBe(1);

    await client.unsubscribeAll();
    expect(transport.unsubscribeCalls).toBe(2); // only the still-active handle
  });

  test("a failed subscription leaves the registry and aborts its failureSignal", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });

    const onError = mock(() => {});
    const sub = await client.allMids(() => {}, { onError });
    expect(sub.failureSignal.aborted).toBe(false); // guaranteed present on client-returned handles

    const error = new TransportError("subscription failed");
    transport.calls[0].options?.onError?.(error); // the transport reports a post-confirmation failure

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
    expect(sub.failureSignal.aborted).toBe(true);
    expect(sub.failureSignal.reason).toBe(error);

    await client.unsubscribeAll(); // the failed handle was already removed from the registry
    expect(transport.unsubscribeCalls).toBe(0);
  });

  test("failureSignal stays inert on a voluntary unsubscribe", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });

    const sub = await client.allMids(() => {});
    await sub.unsubscribe();

    expect(sub.failureSignal.aborted).toBe(false);
  });

  test("a failure recorded before the first access still aborts the synthesized failureSignal", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });

    const sub = await client.allMids(() => {});
    const error = new TransportError("subscription failed");
    transport.calls[0].options?.onError?.(error); // fails before anyone read failureSignal

    expect(sub.failureSignal.aborted).toBe(true);
    expect(sub.failureSignal.reason).toBe(error);
  });

  test("a transport-provided failureSignal is passed through, not wrapped", async () => {
    const transport = new MockSubscriptionTransport();
    const controller = new AbortController();
    transport.handleExtras = { failureSignal: controller.signal };

    const client = new SubscriptionClient({ transport });
    const sub = await client.allMids(() => {});

    expect(sub.failureSignal).toBe(controller.signal);
  });

  test("an in-flight subscribe resolves with an already-unsubscribed handle after unsubscribeAll", async () => {
    const transport = new PendingSubscriptionTransport();
    const client = new SubscriptionClient({ transport });

    const pending = client.allMids(() => {});
    await client.unsubscribeAll(); // nothing confirmed yet: resolves without unsubscribing anything
    expect(transport.unsubscribeCalls).toBe(0);

    transport.confirmNext();
    await pending; // resolves with a handle that was retired as the confirmation landed
    expect(transport.unsubscribeCalls).toBe(1);

    await client.unsubscribeAll(); // the late handle never joined the registry
    expect(transport.unsubscribeCalls).toBe(1);
  });

  test("an in-flight subscribe that fails after unsubscribeAll rejects normally", async () => {
    const transport = new PendingSubscriptionTransport();
    const client = new SubscriptionClient({ transport });

    const pending = client.allMids(() => {});
    await client.unsubscribeAll();

    transport.failNext(new TransportError("subscription refused"));
    await expect(pending).rejects.toThrow("subscription refused");
    expect(transport.unsubscribeCalls).toBe(0);
  });

  test("resolves immediately when nothing is subscribed", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });

    await client.unsubscribeAll();
    expect(transport.unsubscribeCalls).toBe(0);

    await unsubscribeAll({ transport: new MockSubscriptionTransport() }); // no client ever used it
  });

  test("two clients on one transport share the teardown scope", async () => {
    const transport = new MockSubscriptionTransport();
    const clientA = new SubscriptionClient({ transport });
    const clientB = new SubscriptionClient({ transport });

    await clientA.allMids(() => {});
    await clientB.l2Book({ coin: "ETH" }, () => {});

    await clientA.unsubscribeAll();
    expect(transport.unsubscribeCalls).toBe(2);
  });
});

describe("unsubscribeAll (standalone function)", () => {
  test("tears down the subscriptions a SubscriptionClient opened on the transport", async () => {
    const transport = new MockSubscriptionTransport();
    const client = new SubscriptionClient({ transport });

    await client.allMids(() => {});
    await client.allMids(() => {});

    await unsubscribeAll({ transport });
    expect(transport.unsubscribeCalls).toBe(2);

    await client.unsubscribeAll(); // same shared registry: already empty
    expect(transport.unsubscribeCalls).toBe(2);
  });
});
