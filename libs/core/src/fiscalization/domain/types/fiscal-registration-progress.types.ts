/**
 * Fiscal Registration Progress Types (#2526)
 *
 * Where one order's registration is, as a single value a surface can render.
 *
 * It exists because registration became asynchronous (#2525). Before that, the
 * request that asked for a registration also carried its outcome, so "where is
 * this now" was never a question anyone had to answer. Now the work outlives the
 * request that started it, and a panel reopened halfway through has only
 * persisted state to read.
 *
 * The record alone cannot answer it. Between the job being written and the job
 * running there is no record at all, and that window is exactly the one an
 * operator is looking at right after clicking. So the value is resolved from two
 * facts - the record, and whether the enqueued job is still live - and neither
 * is sufficient alone.
 *
 * WHAT IT DOES NOT SAY. There is no value here meaning "nearly done", no elapsed
 * or remaining time, and no step count. OpenLinker hands a sale to a provider and
 * waits for one answer; it observes nothing in between and can promise no
 * deadline, so the vocabulary must not be able to express one.
 *
 * @module libs/core/src/fiscalization/domain/types
 */
import type {
  FiscalRegistrationFailureMode,
  FiscalRegistrationStatus,
} from './fiscalization.types';

/**
 * The closed set of answers.
 *
 * `stalled` is the one that earns its place by being uncomfortable: intent was
 * recorded and nothing is running. Folding it into `queued` would tell an
 * operator the work is waiting its turn when nothing will ever pick it up, and
 * folding it into a failure would assert an outcome the provider never gave. It
 * is the state a repeat of the request resolves, by re-driving the dead job.
 *
 * `interrupted` is `stalled`'s twin and is kept apart from it BECAUSE OF WHAT
 * MAY ALREADY HAVE HAPPENED. Both mean nothing is running, but they differ on
 * the one question that matters for a fiscal document: whether the provider was
 * ever called. A `pending` record was written before any outbound call and never
 * claimed, and no record at all means the call was never reached, so on both of
 * those paths nothing crossed the boundary and a surface may say so. A
 * `registering` record whose lease expired is a crashed attempt that MAY have
 * reached the provider - the process died and a dead socket says nothing about
 * whether the request was processed - so nothing may state an absence there.
 * One word cannot carry both without being false on one of them.
 *
 * `rejected` and `in-doubt` are kept apart because only one of them may be
 * re-attempted. A rejection means the provider definitely created nothing; an
 * in-doubt outcome means OpenLinker does not know, and registering again is how
 * one sale ends up with two receipts.
 */
export const FiscalRegistrationProgressValues = [
  'not-requested',
  'queued',
  'running',
  'stalled',
  'interrupted',
  'registered',
  'rejected',
  'in-doubt',
] as const;

export type FiscalRegistrationProgress = (typeof FiscalRegistrationProgressValues)[number];

/**
 * Liveness of the enqueued registration job, reduced to what the rule needs.
 *
 * Deliberately not the sync job's own status vocabulary: this type would then
 * carry the sync context's terms into a fiscalization domain rule, and every
 * future job status would silently become a fiscal question. `live` covers
 * queued and running, `dead` is a job that exhausted its retries, `none` is no
 * job row at all.
 */
export type FiscalRegistrationJobLiveness = 'live' | 'dead' | 'none';

/** The two facts the answer is resolved from. Both are already-loaded state. */
export interface FiscalRegistrationProgressInput {
  /**
   * The record held under this (connection, order) key, or `null` when none
   * exists yet. `leaseLive` is the record's own `isLeaseLive` answer, passed in
   * rather than recomputed so the caller controls the instant every field of one
   * response is evaluated against.
   */
  record: {
    status: FiscalRegistrationStatus;
    failureMode: FiscalRegistrationFailureMode | null;
    leaseLive: boolean;
  } | null;
  job: FiscalRegistrationJobLiveness;
}

/**
 * Resolve the one value, purely.
 *
 * Co-located with the type it resolves (the pure-rule exception in
 * `engineering-standards.md`): adding a member to the union means editing this
 * function in the same commit, so a surface cannot be handed a value nothing
 * produces.
 *
 * A settled record OUTRANKS the job. A job row can linger as `running` for a
 * moment after the record reached its outcome, and reporting `running` over a
 * registered receipt would be a false claim in the direction that matters.
 */
export function resolveFiscalRegistrationProgress(
  input: FiscalRegistrationProgressInput,
): FiscalRegistrationProgress {
  const { record, job } = input;

  if (record !== null) {
    // A settled record is settled whatever else is true of it. Checked before
    // the claim so the ranking matches what this function's docblock says: a
    // record that reached its outcome is never reported as still running.
    if (record.status === 'registered') {
      return 'registered';
    }
    if (record.status === 'failed') {
      // Anything other than a terminal rejection is in doubt, an absent mode
      // included: an unreadable failure is not evidence that nothing landed.
      return record.failureMode === 'rejected' ? 'rejected' : 'in-doubt';
    }
    if (record.leaseLive) {
      return 'running';
    }
    if (job === 'live') {
      // Intent exists and a job will pick it up. True of a never-sent `pending`
      // row and of an abandoned claim alike, and neither needs the operator.
      return 'queued';
    }
    // Nothing is running. The two shapes part company here, on whether the
    // provider can already have been called.
    return record.status === 'registering' ? 'interrupted' : 'stalled';
  }

  if (job === 'live') {
    return 'queued';
  }
  if (job === 'dead') {
    // A job that gave up before it ever wrote a record. Nothing was registered
    // and nothing will be until someone asks again.
    return 'stalled';
  }
  return 'not-requested';
}
