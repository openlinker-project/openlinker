/**
 * KSeF Acknowledgement-Required Exception
 *
 * Raised BEFORE any build/send when a document rests on OpenLinker's reading
 * of the law rather than on a schema fact - a buyer NIP changed by a
 * correction, JST/GV flags without the matching Podmiot3, a basket mixing
 * margin-scheme and ordinary lines. OpenLinker may read the law wrongly, so it
 * suggests and the operator decides: the refusal names a `warningCode`, and
 * re-issuing with that code in `acknowledgedWarnings` proceeds.
 *
 * `reason` is shown to the operator verbatim (`failureCause:
 * 'needs-acknowledgement'`), so it is composed from fixed text only - never
 * from order or buyer data.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
import type { NEEDS_ACKNOWLEDGEMENT_FAILURE_CAUSE } from '@openlinker/core/invoicing';

export class KsefAcknowledgementRequiredException extends Error {
  readonly failureMode = 'rejected' as const;
  readonly failureCause: typeof NEEDS_ACKNOWLEDGEMENT_FAILURE_CAUSE = 'needs-acknowledgement';

  constructor(
    readonly warningCode: string,
    readonly reason: string,
  ) {
    super(`KSeF issuance needs the operator's acknowledgement (${warningCode}): ${reason}`);
    this.name = 'KsefAcknowledgementRequiredException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefAcknowledgementRequiredException);
    }
  }
}

/** Throw unless the operator already acknowledged `warningCode` for this issuance. */
export function requireAcknowledgement(
  acknowledged: readonly string[] | undefined,
  warningCode: string,
  reason: string,
): void {
  if (!acknowledged?.includes(warningCode)) {
    throw new KsefAcknowledgementRequiredException(warningCode, reason);
  }
}
