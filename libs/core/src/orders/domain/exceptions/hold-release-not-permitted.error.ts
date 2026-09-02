/**
 * Hold Release Not Permitted Error (#2339, DESIGN §6.4)
 *
 * Raised by `OrderHoldService.release` when a SERVICE tries to release a hold it
 * did not place — whether a DIFFERENT service placed it, or a human did.
 *
 * §6.4 admits exactly two releasers for a service-placed hold: the placing
 * service, or a human with a mandatory note. A third service is neither. The
 * refusal is not bureaucratic — a hold carries a reason only its placer can
 * re-evaluate, so a peer automation clearing it would be asserting a judgement
 * it never made, and the resulting order would proceed with nobody having
 * decided that it should.
 *
 * A **user-placed** hold is covered by the same refusal, which §6.4 does not
 * spell out and which is therefore the deliberate reading of two facts it does
 * state. A human's hold carries a human's reason, so automation clearing it is
 * the same unmade judgement one degree worse; and `order_holds` has no
 * `releasedByService` column, so such a release would persist as
 * `releasedByUserId: null` with no note — a hold released by nobody, which is
 * exactly the unanswerable audit question the actor CHECK exists to prevent at
 * the other end of the row's life.
 *
 * A human releaser is never refused here: an operator overruling automation is
 * the escape hatch the design keeps open, priced at a mandatory note
 * ({@link HoldReleaseNoteRequiredError}). Whether that human is entitled to
 * overrule is a ROLE question, and role lives at the HTTP boundary (#2341
 * guards the route with `@Roles('admin')`) — core has no user roles to read.
 *
 * NOT retryable.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class HoldReleaseNotPermittedError extends Error {
  constructor(
    public readonly holdId: string,
    /** The placing service, or `null` when a human placed the hold. */
    public readonly placedByService: string | null,
    public readonly releasingService: string
  ) {
    super(
      `Order hold ${holdId} was placed by ` +
        (placedByService === null ? 'a user' : `service "${placedByService}"`) +
        ` and cannot be released by service "${releasingService}"`
    );
    this.name = 'HoldReleaseNotPermittedError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HoldReleaseNotPermittedError);
    }
  }
}
