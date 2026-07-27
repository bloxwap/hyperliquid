/**
 * Optional WASM keccak256 provider.
 *
 * keccak256 is the SDK's most frequent hash: every L1 action hashes its msgpack preimage with it,
 * and the EIP-712 `Agent` digest adds two more per signature, so noble's pure-JS `keccak_256`
 * (~2.2 µs per one-shot block) is the largest remaining CPU cost of an L1 order once secp256k1 is
 * accelerated. When the optional `hash-wasm` dependency is installed, {@linkcode keccak256}
 * dispatches to its WASM keccak (~0.5 µs for the 130-byte single-order preimage, ~8.5 µs vs
 * ~61 µs for the 100-order one). Both compute keccak-256, so the output is byte-identical;
 * `tests/signing/keccak.test.ts` pins that identity across sizes, block boundaries, real action
 * preimages, and fuzzed inputs.
 *
 * The acceleration is ambient and lazy, mirroring the `tiny-secp256k1` wiring in
 * `_fastWallet.ts`: the first hash kicks a guarded dynamic import (deduped to one in-flight load),
 * and until the WASM module is ready, hashes transparently use noble — the sync API never blocks
 * on the async init. A missing or broken package — including one that fails the known-answer
 * self-check — leaves every hash on noble for the life of the process. The fallback is silent:
 * unlike the fast wallet, dispatch here is not something the user asked for, so there is nothing
 * to warn about. Users who never hash never load the WASM module.
 * @module
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** The subset of the `hash-wasm` hasher API the provider relies on (validated after import). */
interface WasmKeccak {
  init(): void;
  update(data: Uint8Array): void;
  digest(outputType: "binary"): Uint8Array;
}

/** keccak-256 of the empty input — the known-answer check a WASM build must pass before it is trusted. */
const KECCAK256_EMPTY = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

/**
 * Dynamically imports `hash-wasm` and creates its keccak-256 hasher, returning `undefined` when the
 * optional dependency is missing. The `try` routes an absent package to the noble fallback exactly
 * like the known-answer check in {@linkcode validateWasmKeccak} routes a broken one.
 */
async function loadWasmKeccak(): Promise<WasmKeccak | undefined> {
  try {
    const { createKeccak } = await import("hash-wasm");
    if (typeof createKeccak !== "function") return undefined;
    return await createKeccak(256);
  } catch {
    return undefined;
  }
}

/**
 * Validates a freshly loaded hasher before it is trusted with signed bytes: the three methods the
 * dispatch calls must exist, and the hasher must reproduce the keccak-256 empty vector. A WASM
 * build that fails either check is treated as unavailable, exactly like a missing package.
 */
function validateWasmKeccak(hasher: WasmKeccak | undefined): hasher is WasmKeccak {
  try {
    if (
      hasher === undefined ||
      typeof hasher.init !== "function" ||
      typeof hasher.update !== "function" ||
      typeof hasher.digest !== "function"
    ) {
      return false;
    }
    hasher.init();
    hasher.update(new Uint8Array(0));
    return bytesToHex(hasher.digest("binary")) === KECCAK256_EMPTY;
  } catch {
    return false;
  }
}

/** The loader the dispatch uses; replaced only by tests through {@linkcode _setKeccakLoaderForTests}. */
let keccakLoader: () => Promise<WasmKeccak | undefined> = loadWasmKeccak;

/**
 * The one in-flight (or settled) load attempt. Deduped deliberately: a failed `import("hash-wasm")`
 * is not necessarily cached by the runtime, so re-trying on every hash would put a rejected module
 * resolution on the hot path of installs without the package.
 */
let loadPromise: Promise<void> | undefined;

/**
 * The ready WASM hasher; `undefined` until the load settles AND validates. A single instance is
 * safe to share: {@linkcode keccak256} is synchronous and no caller code runs between `init()` and
 * `digest()`, so two hashes can never interleave inside the hasher's state.
 */
let wasmHasher: WasmKeccak | undefined;

/** Starts the one-time background load (no-op once started); the dispatch keeps using noble until it settles. */
function kickWasmLoad(): void {
  if (loadPromise !== undefined) return;
  loadPromise = keccakLoader().then(
    (hasher) => {
      if (validateWasmKeccak(hasher)) wasmHasher = hasher;
    },
    () => {
      // A rejected loader leaves the dispatch on noble for the life of the process.
    },
  );
}

/**
 * Computes the 32-byte keccak-256 digest of `data`, on the WASM module once it is ready and on
 * noble's `keccak_256` before that (and permanently when `hash-wasm` is not installed). Output is
 * byte-identical across providers, so which one ran is never observable beyond latency.
 *
 * The first call kicks the background load of the optional dependency; package-internal — not
 * re-exported from `mod.ts`.
 *
 * @param data The preimage bytes.
 * @return The 32-byte digest.
 */
export function keccak256(data: Uint8Array): Uint8Array {
  const hasher = wasmHasher;
  if (hasher !== undefined) {
    hasher.init();
    hasher.update(data);
    return hasher.digest("binary");
  }
  kickWasmLoad();
  return keccak_256(data);
}

/**
 * Starts the background WASM load if it has not started yet and resolves when it has settled
 * (successfully or not). Internal: used by the perf scenarios to measure the WASM provider with
 * the warm-up cost excluded. Not re-exported from `mod.ts`.
 */
export function preloadWasmKeccak(): Promise<void> {
  kickWasmLoad();
  return loadPromise as Promise<void>;
}

/**
 * Internal test hook: swaps the `hash-wasm` loader (pass `undefined` to restore the real one) and
 * resets the provider to its unloaded state, so the next hash re-kicks a load through the new
 * loader. Module mocking cannot reliably simulate a missing dependency — a mocked specifier stays
 * poisoned for the rest of the process and a previously loaded real module shadows the mock, so
 * which path a test sees would depend on file order. Not re-exported from `mod.ts`.
 */
export function _setKeccakLoaderForTests(loader: (() => Promise<WasmKeccak | undefined>) | undefined): void {
  keccakLoader = loader ?? loadWasmKeccak;
  loadPromise = undefined;
  wasmHasher = undefined;
}
