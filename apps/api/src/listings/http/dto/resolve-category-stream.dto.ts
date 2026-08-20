/**
 * Resolve Category Stream Wire Types (#2209, epic #2205)
 *
 * Framing vocabulary for `POST /listings/connections/:id/categories/resolve-stream`,
 * the NDJSON sibling of the batch route. The request body is
 * `ResolveCategoryBatchRequestDto` verbatim - only the delivery differs - so
 * this file owns the *response* side only: the content type, the transport-only
 * keep-alive line, and the Swagger schema for one line of the body.
 *
 * The keep-alive line lives here and not in `@openlinker/core/listings` on
 * purpose: it carries no resolution outcome and exists solely because a long
 * quiet period on a chunked HTTP response is indistinguishable from a dead
 * socket. An in-process consumer of `resolveCategoriesStream` has no such
 * problem and must not have to know the kind exists.
 *
 * @module apps/api/src/listings/http/dto
 * @see {@link ResolveCategoryBatchRequestDto} for the shared request shape
 */
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

import type { EanCategoryMatchStreamEvent } from '@openlinker/core/listings';

/** NDJSON: one complete JSON value per line, no enclosing array. */
export const RESOLVE_CATEGORY_STREAM_CONTENT_TYPE = 'application/x-ndjson';

/**
 * Liveness filler emitted while the resolver is quiet (an Allegro `Retry-After`
 * backoff can hold a chunk for 30 s or more). Its own `kind` keeps it outside
 * the core `EanCategoryMatchStreamEventKindValues` union, so a client that
 * switches on the discriminant drops it instead of counting it as a resolved
 * variant - the one property that makes the line safe to inject anywhere.
 */
export interface ResolveCategoryStreamKeepAliveLine {
  kind: 'keep-alive';
}

export const RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_LINE: ResolveCategoryStreamKeepAliveLine = {
  kind: 'keep-alive',
};

/**
 * Quiet period after which a keep-alive line is emitted. Well under the SPA's
 * 30 s request timeout (`apps/web/src/app/api/api-client.ts`), so a stalled
 * resolver still proves the response alive before the client gives up on it.
 */
export const RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_INTERVAL_MS = 10_000;

/** One line of the NDJSON body. */
export type ResolveCategoryStreamLine =
  | EanCategoryMatchStreamEvent
  | ResolveCategoryStreamKeepAliveLine;

/**
 * Swagger schema for a single line. A streamed body cannot be described as one
 * response object in OpenAPI, so the schema documents the line shape and the
 * operation description explains the framing - same pragmatic split as
 * `findProductsByBarcodeResponseSchema` uses for a discriminated union.
 */
export const resolveCategoryStreamLineSchema: SchemaObject = {
  oneOf: [
    {
      type: 'object',
      description: "One variant's resolution outcome; at most one per input item.",
      properties: {
        kind: { type: 'string', enum: ['result'] },
        variantId: { type: 'string' },
        result: { type: 'object', additionalProperties: true },
      },
      required: ['kind', 'variantId', 'result'],
    },
    {
      type: 'object',
      description:
        'Terminal line, always present exactly once and always last. `completion` ' +
        'distinguishes a finished run from one the client aborted or one that threw ' +
        'mid-stream, which the HTTP status can no longer express once the first line ' +
        'has been written.',
      properties: {
        kind: { type: 'string', enum: ['done'] },
        resolvedCount: { type: 'integer' },
        unresolvedCount: { type: 'integer' },
        completion: { type: 'string', enum: ['complete', 'aborted', 'failed'] },
      },
      required: ['kind', 'resolvedCount', 'unresolvedCount', 'completion'],
    },
    {
      type: 'object',
      description: 'Liveness filler. Carries no data; ignore it.',
      properties: { kind: { type: 'string', enum: ['keep-alive'] } },
      required: ['kind'],
    },
  ],
};
