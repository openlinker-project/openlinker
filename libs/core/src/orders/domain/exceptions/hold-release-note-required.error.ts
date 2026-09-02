/**
 * Hold Release Note Required Error (#2339, DESIGN §6.4)
 *
 * Raised by `OrderHoldService.release` when a HUMAN releases a hold that a
 * SERVICE placed, without supplying a release note.
 *
 * §6.4's rule is "service-placed holds are released by the placing service, or
 * by an admin with a mandatory release note". That is a policy about *who is
 * releasing*, which the schema cannot know — `order_holds.releaseNote` is
 * nullable precisely because a service releasing its own hold owes no note. So
 * the obligation lives here, at the one seam that sees both the placer and the
 * releaser.
 *
 * The note is what makes the override auditable: a machine placed the hold for a
 * reason it can restate, and a human overruling that reason has to say why in
 * the operator's own words.
 *
 * NOT retryable as-is — the caller must resend with a note.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class HoldReleaseNoteRequiredError extends Error {
  constructor(
    public readonly holdId: string,
    /** The service that placed the hold, quoted back so the operator sees it. */
    public readonly placedByService: string
  ) {
    super(
      `Order hold ${holdId} was placed by service "${placedByService}"; ` +
        `releasing it as a user requires a release note`
    );
    this.name = 'HoldReleaseNoteRequiredError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HoldReleaseNoteRequiredError);
    }
  }
}
