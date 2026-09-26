/**
 * Structural {@linkcode AbortSignal} detection for overload disambiguation.
 *
 * The implementation lives in the package root (`src/_base.ts`) so every API layer shares one
 * copy; this module re-exports it for the Info method modules that import through `_base/mod.ts`.
 *
 * @module
 */

export { isAbortSignal } from "../../../../_base.ts";
