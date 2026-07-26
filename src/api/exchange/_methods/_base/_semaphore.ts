/**
 * Per-key mutex registry for serializing async operations.
 * @module
 */

/**
 * A mutual-exclusion lock that wakes waiters in FIFO order.
 *
 * Replaces `@jsr/std__async`'s `Semaphore(1)`, which was only ever used as a
 * single-permit (and itself FIFO) lock.
 */
class Mutex {
  private _locked = false;
  private _waiters: (() => void)[] = [];

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
    const next = this._waiters.shift();
    if (next) next();
    else this._locked = false;
  }
}

/**
 * A reference-counted registry for lazily creating and reusing per-key values.
 *
 * @template K Map key type.
 * @template V Stored value type.
 */
class RefCountedRegistry<K, V> {
  private _map = new Map<K, { value: V; refs: number }>();
  private _factory: () => V;

  /**
   * Creates a new registry instance.
   *
   * @param factory Factory function used to create a new value when a key is first referenced.
   */
  constructor(factory: () => V) {
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
