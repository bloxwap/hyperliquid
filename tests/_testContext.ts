/**
 * Minimal stand-in for `Deno.TestContext`.
 *
 * `bun:test` has no equivalent of `t.step()` that can be called from inside a
 * running test body, so the shared harnesses hand their callbacks this object
 * instead. Sub-steps run inline — exactly the sequential order Deno gave them —
 * and a failure is re-thrown with the step path prepended so the message stays
 * greppable against the pre-migration test names.
 *
 * @module
 */

/** The subset of `Deno.TestContext` the suite actually used. */
export interface TestContext {
  /** Runs `fn` inline as a named sub-step, tagging any failure with the step path. */
  step(name: string, fn: (t: TestContext) => unknown): Promise<void>;
}

/**
 * Creates a test context whose steps run inline.
 *
 * @param path Names of the enclosing steps, used to build the failure prefix.
 */
export function createTestContext(path: readonly string[] = []): TestContext {
  return {
    async step(name: string, fn: (t: TestContext) => unknown): Promise<void> {
      const nested = [...path, name];
      try {
        await fn(createTestContext(nested));
      } catch (error) {
        // Prefix rather than wrap, so `instanceof` checks in the caller keep working.
        if (error instanceof Error) error.message = `${nested.join(" > ")}: ${error.message}`;
        throw error;
      }
    },
  };
}
