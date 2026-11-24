/**
 * eparagony.pl Document Create
 *
 * `POST /documents` for BOTH lanes - a receipt and an invoice are created over
 * the same endpoint with the same two keys, and the answers that need settling
 * before a poll can start are the same answers. Shared here, beside the status
 * reader, for the reason that file gives: the identical half was copied, so a
 * fix to it had to be made twice or it was made once.
 *
 * THE TWO KEYS (see `document-token.policy.ts` for the full argument). The body
 * carries the sale's deterministic `documentToken`, which the vendor never lets
 * hold two documents - that is the exactly-once guarantee. The `Idempotency-Key`
 * header is a per-REQUEST replay guard derived from the token plus the exact
 * body, so a corrected retry after a refusal is a new request rather than a
 * forbidden replay.
 *
 * THREE ANSWERS ARE SETTLED HERE rather than thrown straight back:
 *
 *   - `errorCode: 118` - a document already exists under our token, i.e. an
 *     earlier attempt landed. Fall through to the status read, which resolves
 *     what actually happened. Never a rejection.
 *   - `422` - the header was already used with different data. That proves an
 *     earlier REQUEST, not an earlier document (the vendor remembers a key it
 *     refused), so the token's status decides: a document there is resolved
 *     like `118`; the vendor positively saying it holds none (`92`/`100`) means
 *     nothing was created, which is `rejected`; anything else - the read failed,
 *     or answered with something unrecognised - stays `in-doubt`. Never
 *     `rejected` without that positive answer. Because the header is derived
 *     from the exact body, the `rejected` arm signals a broken assumption and
 *     is logged as `eparagony_idempotency_key_body_mismatch`; its copy does
 *     not promise that Retry fixes it.
 *   - everything else propagates with the classification `EparagonyApiError`
 *     already gave it.
 *
 * @module libs/integrations/eparagony/src/infrastructure/http
 */
import type { LoggerPort } from '@openlinker/shared/logging';

import { EparagonyApiError } from '../../domain/exceptions/eparagony-api.error';
import { deriveRequestIdempotencyKey } from '../../domain/policies/document-token.policy';
import { EPARAGONY_ERROR_DOCUMENT_ALREADY_EXISTS } from '../../domain/types/eparagony-api.types';
import { EPARAGONY_DOCUMENTS_PATH, readEparagonyDocumentStatus } from './eparagony-document-status.reader';
import type { IEparagonyHttpClient } from './eparagony-http-client.interface';

/** HTTP status the vendor answers a replayed `Idempotency-Key` with. */
const REPLAYED_KEY_STATUS = 422;

/**
 * Operator copy for a replayed key the vendor then confirmed created nothing.
 * Fixed text plus the numeric code only, like every `EparagonyApiError` reason.
 *
 * It deliberately does NOT promise that Retry fixes it: the header is derived
 * from the exact body, so a retry re-sends the same key, meets the same `422`
 * and lands here again. Reaching this arm means the vendor disagrees with how
 * we derive the key (see `settleReplayedKey`), which an operator cannot repair.
 * Kept under the 200-character reason cap even with the widest numeric code.
 */
export function replayedKeyNothingCreatedReason(errorCode: number | null): string {
  return (
    'eparagony reports this request key was used with different data, which OpenLinker never ' +
    'sends. Nothing was issued. Retrying will not help - check the connection or contact support' +
    `${codeSuffix(errorCode)}.`
  );
}

/** Operator copy for a replayed key whose document OpenLinker could not check. */
export function replayedKeyUncheckedReason(errorCode: number | null): string {
  return (
    'eparagony refused the request as a repeat of an earlier attempt with different data, and ' +
    `OpenLinker could not check whether it holds a document for this sale${codeSuffix(errorCode)}.`
  );
}

export interface CreateEparagonyDocumentParams {
  http: IEparagonyHttpClient;
  logger: LoggerPort;
  connectionId: string;
  /** The exact body sent; the request key is derived from it. */
  body: { documentToken: string };
  orderId: string;
  /** Transport timeout for the create; the client's own default when absent. */
  timeoutMs?: number;
}

export async function createEparagonyDocument(params: CreateEparagonyDocumentParams): Promise<void> {
  const { http, logger, connectionId, body, orderId } = params;
  const documentToken = body.documentToken;
  try {
    await http.post<unknown>(EPARAGONY_DOCUMENTS_PATH, body, {
      // Derived, never core's raw key: the vendor requires this header to
      // match `/^[0-9A-Za-z_-]+$/` and core's key carries colons.
      headers: { 'Idempotency-Key': deriveRequestIdempotencyKey(documentToken, body) },
      // Safe to re-issue on a 5xx/network failure: the retry sends the SAME
      // body, hence the same key, which the vendor replays rather than
      // re-executes - and the token refuses a second document regardless.
      idempotent: true,
      ...(params.timeoutMs === undefined ? {} : { timeoutMs: params.timeoutMs }),
    });
    logger.log(
      `eparagony.pl accepted the document for order ${orderId} as ${documentToken} ` +
        `[connectionId=${connectionId}]`,
    );
  } catch (error) {
    if (!(error instanceof EparagonyApiError)) {
      throw error;
    }
    if (error.errorCode === EPARAGONY_ERROR_DOCUMENT_ALREADY_EXISTS) {
      // Our token is deterministic, so "already exists" means OUR earlier
      // attempt landed. Reporting a rejection here would be the wrong-direction
      // error: the status read that follows resolves what actually happened.
      logger.warn(
        `eparagony.pl already holds document ${documentToken} for order ${orderId}; ` +
          `reading its status instead of re-creating [connectionId=${connectionId}]`,
      );
      return;
    }
    if (error.statusCode === REPLAYED_KEY_STATUS) {
      await settleReplayedKey(params, error);
      return;
    }
    throw error;
  }
}

/**
 * Decide a `422` by what the vendor holds under the token. Returns when a
 * document exists (the caller's poll resolves it); throws otherwise.
 */
async function settleReplayedKey(
  params: CreateEparagonyDocumentParams,
  refusal: EparagonyApiError,
): Promise<void> {
  const { http, logger, connectionId, orderId } = params;
  const documentToken = params.body.documentToken;
  let held: Awaited<ReturnType<typeof readEparagonyDocumentStatus>>;
  try {
    held = await readEparagonyDocumentStatus(http, documentToken, {
      treatUnknownDocumentAsMissing: true,
    });
  } catch (readError) {
    // The vendor answered the create, so this is not a timeout - but nothing
    // positive says whether a document exists, which is exactly in doubt.
    logger.warn(
      `eparagony.pl refused a replayed key for order ${orderId} and the status read of ` +
        `${documentToken} failed (${readError instanceof Error ? readError.message : 'unknown'}) ` +
        `[connectionId=${connectionId}]`,
    );
    throw new EparagonyApiError(
      `eparagony.pl refused a replayed Idempotency-Key for document ${documentToken} and its ` +
        `status could not be read`,
      REPLAYED_KEY_STATUS,
      { errorCode: refusal.errorCode },
      {
        failureMode: 'in-doubt',
        reason: replayedKeyUncheckedReason(refusal.errorCode),
        failureCause: 'provider-answer-inconclusive',
      },
    );
  }

  if (held === null) {
    // The vendor positively reports no document under the token every request
    // for this sale carried - so the earlier request it remembers created
    // nothing, and neither did this one.
    //
    // Logged at `error` with its own token because this arm should be
    // unreachable: the key is a function of the exact body, so "same key,
    // different data" means the vendor canonicalises bodies differently from
    // us (key order, number formatting) or the hash collided. Either is a
    // broken assumption rather than a routine refusal, and a retry re-derives
    // the identical key, so it repeats until someone looks.
    logger.error(
      `eparagony_idempotency_key_body_mismatch: eparagony.pl refused a replayed key for order ` +
        `${orderId} and holds no document ${documentToken}; nothing was created, and a retry ` +
        `will re-send the same key [connectionId=${connectionId}]`,
    );
    throw new EparagonyApiError(
      `eparagony.pl refused a replayed Idempotency-Key for document ${documentToken} and holds ` +
        `no document under it`,
      REPLAYED_KEY_STATUS,
      { errorCode: refusal.errorCode },
      { failureMode: 'rejected', reason: replayedKeyNothingCreatedReason(refusal.errorCode) },
    );
  }

  logger.warn(
    `eparagony.pl refused a replayed key for order ${orderId} but holds document ` +
      `${documentToken}; resolving it instead of re-creating [connectionId=${connectionId}]`,
  );
}

function codeSuffix(errorCode: number | null): string {
  return errorCode === null ? '' : ` (code ${errorCode})`;
}
