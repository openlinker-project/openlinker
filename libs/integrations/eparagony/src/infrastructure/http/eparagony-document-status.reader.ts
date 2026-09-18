/**
 * eparagony.pl Document Status Reader
 *
 * `GET /documents/{token}/status` is ONE endpoint for BOTH document lanes - the
 * vendor's own contract says so, and the receipt and invoice adapters each poll
 * it. So the transport lives here once, beside the client it wraps, rather than
 * twice inside two adapters.
 *
 * WHAT IS SHARED IS THE TRANSPORT, NOT THE MEANING. The unknown-document
 * translation, the non-object-body guard, the backoff shape and the clamp that
 * keeps a poll inside its lane's fiscal deadline are identical by nature; the
 * terminal predicate, the default budget and the deadline each poll must fit
 * inside are NOT, and stay with their adapter. Before this file the identical
 * half was copied, so a fix to the unknown-document translation or to the clamp
 * had to be made twice or it was made once.
 *
 * Deliberately NOT a class and deliberately not injected: it holds no state and
 * takes the client as an argument, so neither adapter's construction changes and
 * neither gains a dependency it did not already have.
 *
 * @module libs/integrations/eparagony/src/infrastructure/http
 */
import { EparagonyApiError } from '../../domain/exceptions/eparagony-api.error';
import { EparagonyNetworkError } from '../../domain/exceptions/eparagony-network.error';
import {
  EPARAGONY_ERROR_UNKNOWN_DOCUMENT,
  type EparagonyDocumentStatusResponse,
} from '../../domain/types/eparagony-api.types';
import type { IEparagonyHttpClient } from './eparagony-http-client.interface';

/** Resource path both lanes create under and read status from. */
export const EPARAGONY_DOCUMENTS_PATH = 'documents';

/** Floor on an operator-configured poll timeout, shared by both lanes. */
export const MIN_STATUS_POLL_TIMEOUT_MS = 5_000;

/**
 * Ceiling on an operator-configured poll timeout, so neither lane's fiscal
 * deadline can be configured away.
 *
 * ONE value for both lanes because both deadlines are 110 s, and each adapter
 * asserts THIS constant against ITS OWN deadline at module load - so the two
 * assertions stay independent even though the ceiling is shared.
 */
export const MAX_STATUS_POLL_TIMEOUT_MS = 90_000;

export const STATUS_POLL_INITIAL_DELAY_MS = 1_000;
export const STATUS_POLL_BACKOFF_MULTIPLIER = 1.6;
export const STATUS_POLL_MAX_DELAY_MS = 5_000;

/**
 * Read one document status.
 *
 * `treatUnknownDocumentAsMissing` converts the vendor's "no such token"
 * rejection into `null` - which the fiscalization locator reports as
 * `not-found` and the invoice clearance read reports as "no change". NEITHER
 * ISSUANCE POLL ASKS FOR IT, because a document that vanished mid-poll is not a
 * clean absence and must stay in doubt.
 *
 * A body that is not an object at all is a contract break rather than a status,
 * and surfaces as {@link EparagonyNetworkError} - i.e. `in-doubt`, never a
 * rejection, because the document may exist perfectly well behind an
 * unreadable answer.
 */
export async function readEparagonyDocumentStatus(
  http: IEparagonyHttpClient,
  documentToken: string,
  options: { treatUnknownDocumentAsMissing: boolean },
): Promise<EparagonyDocumentStatusResponse | null> {
  try {
    const { data } = await http.get<EparagonyDocumentStatusResponse>(
      `${EPARAGONY_DOCUMENTS_PATH}/${encodeURIComponent(documentToken)}/status`,
    );
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new EparagonyNetworkError(
        `eparagony.pl returned a non-object status body for document ${documentToken}`,
      );
    }
    return data;
  } catch (error) {
    if (
      options.treatUnknownDocumentAsMissing &&
      error instanceof EparagonyApiError &&
      error.errorCode !== null &&
      EPARAGONY_ERROR_UNKNOWN_DOCUMENT.includes(error.errorCode)
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Clamp an operator-configured poll timeout into the range the lane's deadline
 * invariant allows.
 *
 * The DEFAULT is the caller's, because the two lanes budget differently - a
 * receipt is registered on a device and an invoice is composed and relayed - and
 * a shared default would silently re-budget one of them. The floor and the
 * ceiling are shared, because they are safety bounds rather than budgets: below
 * the floor a poll gives up while the vendor is still answering, and above the
 * ceiling one call can outlive core's in-flight lease and issue twice.
 *
 * A non-numeric or non-finite value falls back to the default rather than
 * throwing: `config` is JSONB, and refusing to register a real sale over a
 * mistyped timeout would be the worse failure.
 */
export function resolveStatusPollTimeoutMs(
  configured: number | undefined,
  defaultTimeoutMs: number,
): number {
  if (typeof configured !== 'number' || !Number.isFinite(configured)) {
    return defaultTimeoutMs;
  }
  return Math.min(Math.max(configured, MIN_STATUS_POLL_TIMEOUT_MS), MAX_STATUS_POLL_TIMEOUT_MS);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
