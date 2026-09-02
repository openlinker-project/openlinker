/**
 * Exhaustiveness Assertion
 *
 * The shared form of the repo's inline `const _exhaustive: never = value;`
 * idiom: a compile-time proof that a discriminated-union `switch` handles every
 * member, plus a runtime throw for the case where a widened union reaches the
 * default arm from outside the type system (an out-of-tree plugin compiled
 * against an older contract, or a persisted value read back).
 *
 * Home rationale — `engineering-standards.md § The pure-rule exception to
 * "types only"`: this is a pure function (no I/O, no injected dependency, no
 * framework import, no argument mutation), and it *is* the narrowing rule for
 * the `never` type it sits with. Note that this barrel previously exported type
 * aliases only; `assertNever` is its first runtime export, admitted under that
 * exception rather than as a precedent for general helpers.
 *
 * @module libs/shared/src/types
 */

/**
 * Assert that `value` is `never` — i.e. that every member of the union it came
 * from has already been handled by an earlier branch.
 *
 * Adding a member to the union makes every call site that does not handle it a
 * **compile** error, which is the point: the alternative is a `default:` arm
 * that silently absorbs the new member at runtime.
 *
 * @param value the supposedly-impossible value (must narrow to `never`)
 * @param context optional caller-supplied label naming the union being switched
 *   on, so the thrown message identifies the site without a stack trace
 * @throws {Error} always
 */
export function assertNever(value: never, context?: string): never {
  const rendered = ((): string => {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  })();
  throw new Error(
    `Unhandled union member${context ? ` in ${context}` : ''}: ${rendered}`
  );
}
