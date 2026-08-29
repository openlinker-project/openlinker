/**
 * Automation Step Count Error (#2358, Wave-2 spec §5.5)
 *
 * The action list is empty, or longer than the cap of three.
 *
 * The cap is spec §5.5's — *"max 3 steps, run in order, stop on first failure"*
 * — because unbounded chaining is a scripting language with extra clicks, which
 * §6 refuses outright. The floor is this slice's: a rule with no steps is a rule
 * that does nothing, and saving one silently would present the operator with an
 * armed automation that can never have an effect.
 *
 * **Enforced here rather than by a DB CHECK constraint, deliberately.** The
 * integration harness builds schema via TypeORM `synchronize`, which emits no
 * raw CHECK — a constraint present only in the migration would hold in
 * production and silently not in tests, which is worse than no constraint at
 * all.
 *
 * @module libs/core/src/automation/domain/exceptions
 */

/** The action list is outside the permitted 1..3 range. */
export class AutomationStepCountError extends Error {
  constructor(
    public readonly count: number,
    public readonly min: number,
    public readonly max: number,
  ) {
    super(
      `An automation must have between ${min} and ${max} steps; received ${count}.`,
    );
    this.name = 'AutomationStepCountError';
    Error.captureStackTrace(this, this.constructor);
  }
}
