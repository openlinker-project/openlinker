/**
 * resolveLabelDownloadError (#2671)
 *
 * Pure mapper from a shipment label-download failure to an operator-facing
 * struct, shared by both manual call sites (order-detail panel's
 * `ShipmentActionButtons`, the `/shipments` row accordion's
 * `ShipmentRowDetail`) and the post-generation auto-download path in
 * `GenerateLabelForm`, so the three cannot drift into three different toast
 * strings for the same backend outcome.
 *
 * `retryable` is typed as the existing `RetryabilityClass` (not a plain
 * boolean) so a carrier-credential rejection renders a distinct "needs
 * admin" state instead of collapsing into the same "no retry" bucket as a
 * 404 or a 422 - a click from the operator can never fix either, but only
 * one of them is actually the operator's problem to fix. This does NOT call
 * `deriveRetryabilityClass` from `shipment-retryability.ts` - that helper
 * classifies a label-GENERATION failure from a persisted `providerCode`
 * string shape, and this is a download-time HTTP failure with no persisted
 * shipment field to key off (see that module's own header comment). The two
 * share only the vocabulary, not the derivation.
 *
 * No call site renders a distinct "Try again" affordance today - the copy
 * alone carries the retryable/not-retryable distinction (a `transient`
 * network toast reads "try again"; a `permanent` 404/422 toast doesn't). A
 * `retryable`-gated retry BUTTON would need a toast action slot the shared
 * `ToastProvider` doesn't have yet; wiring one is future work, not something
 * to half-build here as an unused export (PR #2700 review).
 *
 * Discriminators below are pinned to
 * `apps/api/src/shipping/http/shipment.controller.ts`'s `toHttpException`
 * (read from source, not guessed):
 *
 *   1. `ApiError.isNetworkError()` (status 0 - the fetch never got a
 *      response, or `ApiError.fromTimeout`) -> transient. The request never
 *      reached the API at all, distinct from #6 below.
 *   2. status 404 (`ShipmentNotFoundException`) -> permanent. NestJS's
 *      default `NotFoundException(message)` body carries no exception-name
 *      field, so status alone is the only, and here unambiguous, signal.
 *   2b. status 409, code `SHIPMENT_LABEL_NOT_READY` (`LabelNotReadyException`) -> transient.
 *      The carrier has the shipment but is still preparing the document; the
 *      download hook has already waited, so this is only reached on timeout.
 *   3. status 422, `error.message` contains 'generate the label first'
 *      (`LabelNotAvailableException`) -> permanent, "not yet".
 *   4. status 422, otherwise (`LabelDocumentNotSupportedException`) ->
 *      permanent, "never". Distinguished from #3 by MESSAGE TEXT only - the
 *      controller wraps both in a bare `new UnprocessableEntityException(
 *      error.message)` with no `error: exceptionName` field, so there is
 *      nothing else to key on without a backend change (explicitly out of
 *      scope for #2671). Keep the substring in lockstep with
 *      `LabelNotAvailableException`'s own message template.
 *   5. status 502, `details.providerCode` is an own property
 *      (`ShippingProviderRejectionException` - the controller builds this
 *      branch's body as `{ message, providerCode, details }`, always
 *      including the key) -> unknown ("maybe" - a structured carrier
 *      rejection, may or may not resolve on retry). `details.message` is
 *      ALREADY role-redacted server-side (#1826) - echo it verbatim, never
 *      re-redact on the FE. `providerCode` is a non-PII support reference
 *      (#1428) and is always present regardless of role.
 *   6. status 502, no `providerCode` key at all
 *      (`ShippingProviderAuthException` - the controller passes a plain
 *      string to `new BadGatewayException(error.message)`, which has no
 *      `providerCode` field) -> auth. Our stored carrier credentials were
 *      rejected; nothing the operator's retry can fix.
 *   7. any other status (the unclassified 500, or an unmodeled shape) ->
 *      unknown, FIXED copy only.
 *
 * Security invariant: only branch 5 surfaces the server's own message -
 * and only because the backend has already redacted it for a
 * non-`shipments:write` caller. Every other branch, including the
 * unclassified-500 fallback, emits fixed copy. The controller's own comment
 * on that branch notes it logs+returns the raw `error.message` unsanitised -
 * an unmodeled shape must never be echoed to the operator.
 *
 * Every title and description reads the `shipments.labelDownloadError` copy
 * at call time, so it follows the active language (ADR-081).
 *
 * @module apps/web/src/features/shipments/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { getMessages, interpolate } from '../../../shared/i18n';
import type { AlertTone } from '../../../shared/ui/alert';
import type { RetryabilityClass } from './shipment-retryability';

export interface LabelDownloadError {
  title: string;
  description: string;
  retryable: RetryabilityClass;
  /** True while the carrier is still preparing a label that WAS bought, so a
   *  caller that normally words every failure as "couldn't fetch" can say the
   *  accurate thing instead (the label is fine, it just is not ready). */
  pending: boolean;
  /** Derived from `retryable` alone (see `TONE_BY_RETRYABLE`) - one place
   *  decides how urgent a class reads, so a call site never picks its own
   *  tone per branch and drifts from the other two call sites. */
  tone: AlertTone;
}

interface ProviderRejectionBody {
  message?: string;
  providerCode?: string | null;
}

function hasProviderCode(details: unknown): details is ProviderRejectionBody {
  return typeof details === 'object' && details !== null && 'providerCode' in details;
}

/** `permanent` (404/422) is not urgent - it's an "unavailable" state, not a
 *  failure the operator caused. `transient` (network) is a hiccup. `auth`
 *  and `unknown` (structured rejection / unclassified) are real problems. */
const TONE_BY_RETRYABLE: Record<RetryabilityClass, AlertTone> = {
  permanent: 'warning',
  transient: 'warning',
  auth: 'error',
  unknown: 'error',
};

type UntonedLabelDownloadError = Omit<LabelDownloadError, 'tone' | 'pending'> & {
  pending?: boolean;
};

function withTone(result: UntonedLabelDownloadError): LabelDownloadError {
  return { ...result, pending: result.pending ?? false, tone: TONE_BY_RETRYABLE[result.retryable] };
}

function unknownFallback(): UntonedLabelDownloadError {
  const copy = getMessages('shipments').labelDownloadError.unknown;
  return { title: copy.title, description: copy.description, retryable: 'unknown' };
}

export function resolveLabelDownloadError(error: unknown): LabelDownloadError {
  const copy = getMessages('shipments').labelDownloadError;
  if (!(error instanceof ApiError)) {
    return withTone(unknownFallback());
  }

  if (error.isNetworkError()) {
    return withTone({
      title: copy.network.title,
      description: copy.network.description,
      retryable: 'transient',
    });
  }

  if (error.status === 404) {
    return withTone({
      title: copy.notFound.title,
      description: copy.notFound.description,
      retryable: 'permanent',
    });
  }

  if (error.status === 409 && error.code === 'SHIPMENT_LABEL_NOT_READY') {
    // Pending, not failed: the label was bought and the carrier is still
    // rendering it. `useLabelDownload` already waited; this is what is left
    // when the wait ran out.
    return withTone({
      title: copy.notReady.title,
      description: copy.notReady.description,
      retryable: 'transient',
      pending: true,
    });
  }

  if (error.status === 422) {
    if (
      error.code === 'SHIPMENT_LABEL_NOT_GENERATED' ||
      // eslint-disable-next-line no-restricted-syntax -- fallback match for a backend that predates the SHIPMENT_LABEL_NOT_GENERATED code; not rendered
      error.message.includes('generate the label first')
    ) {
      return withTone({
        title: copy.noLabelYet.title,
        description: copy.noLabelYet.description,
        retryable: 'permanent',
      });
    }
    return withTone({
      title: copy.notSupported.title,
      description: copy.notSupported.description,
      retryable: 'permanent',
    });
  }

  if (error.status === 502) {
    if (hasProviderCode(error.details)) {
      const body = error.details;
      const code = body.providerCode;
      // eslint-disable-next-line no-restricted-syntax -- the carrier's own words, shown behind a translated title like a provider refusal
      const message = body.message ?? error.message;
      return withTone({
        title: copy.providerRejected.title,
        description: code
          ? interpolate(copy.providerRejected.messageWithRef, { message, code })
          : message,
        retryable: 'unknown',
      });
    }
    return withTone({
      title: copy.credentialsRejected.title,
      description: copy.credentialsRejected.description,
      retryable: 'auth',
    });
  }

  return withTone(unknownFallback());
}
