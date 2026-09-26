/**
 * Per-key mutex registry for serializing async operations.
 * @module
 */

/**
 * A mutual-exclusion lock that wakes waiters in FIFO order.
 *
 * Replaces `@jsr/std__async`'s `Semaphore(1)`, which was only ever used as a
 * single-permit (and itself FIFO) lock.
 *
 * Waiters sit in a grow-only array with a head index rather than `Array.shift()`:
 * under a contended wallet (hundreds of concurrent orders) each release would
 * otherwise copy the remaining queue — O(n) per wake-up, O(n²) for a burst.
 * Compaction runs only when the head has walked past half the storage, so the
 * amortized cost of enqueue/dequeue stays O(1).
 */
class Mutex {
  private _locked: boolean;
  private _waiters: (() => void)[];
  /** Index of the next waiter to wake; advanced on release, never decremented mid-burst. */
  private _head: number;

  constructor() {
    this._locked = false;
    this._waiters = [];
    this._head = 0;
  }

  /**
   * Acquires the lock, waiting until it is free.
   *
   * @return A promise that resolves once the caller holds the lock.
   */
  acquire(): Promise<void> {
    if (!this._locked) {
      this._locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this._waiters.push(resolve));
  }

  /** Releases the lock, waking the longest-waiting waiter if any. */
  release(): void {
    if (this._head < this._waiters.length) {
      const next = this._waiters[this._head];
      // Drop the reference so a long-lived mutex does not pin resolved closures.
      this._waiters[this._head++] = undefined as unknown as () => void;
      // Compact when half the storage is dead so the array cannot grow without bound
      // across many contended bursts on the same key.
      if (this._head > 16 && this._head * 2 >= this._waiters.length) {
        this._waiters = this._waiters.slice(this._head);
        this._head = 0;
      }
      next();
    } else {
      this._locked = false;
      // Idle: drop any residual storage so a quiet wallet costs nothing.
      if (this._waiters.length > 0) {
        this._waiters = [];
        this._head = 0;
      }
    }
  }
}

/**
 * A reference-counted registry for lazily creating and reusing per-key values.
 *
 * @template K Map key type.
 * @template V Stored value type.
 */
class RefCountedRegistry<K, V> {
  private _map: Map<K, { value: V; refs: number }>;
  private _factory: () => V;

  /**
   * Creates a new registry instance.
   *
   * @param factory Factory function used to create a new value when a key is first referenced.
   */
  constructor(factory: () => V) {
    this._map = new Map();
    this._factory = factory;
  }

  /**
   * Increments the reference count for a key and returns its value.
   *
   * If the key is not present, a new value is created via the factory.
   *
   * @param key Registry key.
   * @return The value associated with the key.
   */
  ref(key: K): V {
    let entry = this._map.get(key);
    if (!entry) {
      entry = { value: this._factory(), refs: 0 };
      this._map.set(key, entry);
    }
    entry.refs++;
    return entry.value;
  }

  /**
   * Decrements the reference count for a key.
   *
   * When the count reaches zero, the entry is removed.
   *
   * @param key Registry key.
   */
  unref(key: K): void {
    const entry = this._map.get(key);
    if (!entry) return;
    if (--entry.refs === 0) {
      this._map.delete(key);
    }
  }
}

const mutexes = new RefCountedRegistry(() => new Mutex());

/**
 * Acquires a lock for the given key, executes the provided async function, and releases the lock.
 *
 * @param key The key to lock on.
 * @param fn The async function to execute while holding the lock.
 * @return The result of the async function.
 */
export async function withLock<K, T>(key: K, fn: () => Promise<T>): Promise<T> {
  const mutex = mutexes.ref(key);
  await mutex.acquire();
  try {
    return await fn();
  } finally {
    mutex.release();
    mutexes.unref(key);
  }
}
