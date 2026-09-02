/**
 * Exhaustiveness Assertion — unit tests (#2286)
 *
 * `assertNever`'s primary contract is compile-time and therefore untestable at
 * runtime. What is testable is the fallback: the throw a widened union produces
 * when it reaches a default arm from outside the type system, and the message
 * that identifies which value and which site.
 *
 * @module libs/shared/src/types/__tests__
 */
import { assertNever } from '../exhaustive.types';

describe('assertNever', () => {
  const unhandled = { type: 'amended' } as unknown as never;

  it('throws, naming the unhandled value', () => {
    expect(() => assertNever(unhandled)).toThrow(/Unhandled union member: .*amended/);
  });

  it('includes the caller-supplied context so the site is identifiable without a stack trace', () => {
    expect(() => assertNever(unhandled, 'OrderLifecycleEvent')).toThrow(
      /Unhandled union member in OrderLifecycleEvent: .*amended/
    );
  });

  it('still throws for a value JSON.stringify cannot render', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => assertNever(circular as unknown as never, 'circular')).toThrow(
      /Unhandled union member in circular:/
    );
  });

  it('renders an undefined value rather than throwing on the render itself', () => {
    expect(() => assertNever(undefined as unknown as never)).toThrow(
      'Unhandled union member: undefined'
    );
  });
});
