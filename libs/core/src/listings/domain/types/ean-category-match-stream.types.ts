/**
 * EAN Category Match Stream Types
 *
 * Neutral event vocabulary for per-variant category resolution delivered
 * incrementally (#2207, epic #2205). `EanCategoryMatcher` answers with a
 * complete `Map` or nothing, so nothing between "called" and "returned" is
 * observable; these types are the shape the streaming sibling capability and
 * `ICategoryResolutionService.resolveCategoriesStream` emit as each variant
 * resolves.
 *
 * Marketplace-neutral by construction: an event carries a `variantId` plus the
 * same `EanMatchResult` envelope the batch path already returns, so a consumer
 * that renders the batch result can render a stream event unchanged.
 *
 * @module libs/core/src/listings/domain/types
 */

import type { EanMatchResult } from './ean-category-match.types';

/**
 * Runtime array of the stream-event discriminants, per
 * `engineering-standards.md § Union Types: as const Pattern`.
 *
 * It is the source of truth two hand-written copies are checked against, since
 * neither can import it: the NDJSON decoder in `apps/web` (a browser module
 * cannot depend on core) and the per-line Swagger schema in the API app, which
 * spells each discriminant inside its own `oneOf` branch. `scripts/check-resolve-stream-mirror.mjs`
 * fails the build when a kind is added here and not mirrored there - a drift
 * that would otherwise surface as the client silently dropping a line kind it
 * does not recognise. It is deliberately NOT used to validate inbound lines at
 * runtime: the decoder narrows to the kinds it can actually handle, which is a
 * stricter and more useful test than membership of this array.
 */
export const EanCategoryMatchStreamEventKindValues = ['result', 'done'] as const;

export type EanCategoryMatchStreamEventKind =
  (typeof EanCategoryMatchStreamEventKindValues)[number];

/**
 * One variant's outcome, as yielded by an `EanCategoryMatcherStreaming`
 * adapter. Deliberately kind-less: the discriminant and the terminal tally are
 * owned by the service that composes the stream, so an adapter never has to
 * know the event protocol.
 */
export interface EanCategoryMatchStreamItem {
  variantId: string;
  result: EanMatchResult;
}

/** One resolved variant. Exactly one per input item on a completed stream. */
export interface EanCategoryMatchStreamResultEvent {
  kind: 'result';
  variantId: string;
  result: EanMatchResult;
}

/**
 * How a stream ended, carried on the terminal event.
 *
 * The distinction is on the wire rather than left to a thrown exception because
 * the transport (epic #2205 step 4) serializes these events as NDJSON: by the
 * time a mid-run failure happens the response status is long since committed,
 * so a consumer reading lines would otherwise see a `done` indistinguishable
 * from a clean finish and treat a truncated run as authoritative. Epic #2205
 * decision 3 turns exactly on that reading - resume the unresolved variants
 * rather than re-run the chunk - so it has to survive the transport.
 *
 * - `complete` - every input item was reported; the tallies sum to the input size.
 * - `aborted` - the caller's signal fired, so scheduling stopped early
 *   (ADR-047 § Consequences); the tallies cover only what had already landed.
 * - `failed` - the run threw. The tallies still describe the results actually
 *   delivered before the throw, which is what a resume needs.
 */
export const EanCategoryMatchStreamCompletionValues = ['complete', 'aborted', 'failed'] as const;

export type EanCategoryMatchStreamCompletion =
  (typeof EanCategoryMatchStreamCompletionValues)[number];

/**
 * Terminal event, emitted exactly once and always last - on the failure path too.
 *
 * `resolvedCount` counts variants that reached a single destination category
 * (`matched`); `unresolvedCount` counts every other outcome (`multi-match`,
 * `no-ean`, `no-match`) - the variants still needing operator action. It is
 * deliberately not `failedCount`: a `multi-match` is a successful catalogue hit
 * awaiting disambiguation and a `no-ean` is a data gap, so neither is an error,
 * and the grouping a progress UI needs is "nothing to do" vs "N rows need you".
 * They sum to the number of `result` events actually emitted, which equals the
 * input size only when `completion` is `complete`.
 */
export interface EanCategoryMatchStreamDoneEvent {
  kind: 'done';
  resolvedCount: number;
  unresolvedCount: number;
  completion: EanCategoryMatchStreamCompletion;
  /**
   * Whether a destination catalogue was actually consulted for these EANs.
   *
   * `false` means every `no-match` in this stream is an artefact of there being
   * nothing to ask, not a statement about the operator's barcodes: a destination
   * that borrows its taxonomy and has no owner connection to borrow a matcher
   * from resolves its category at build time instead (#1045). A consumer must
   * not turn those into "no category found" blockers - #1934/F10 is what the
   * inverse mistake costs, where every row read as resolvable and then every
   * child failed on a missing category at submit.
   */
  catalogueLookupPerformed: boolean;
}

export type EanCategoryMatchStreamEvent =
  | EanCategoryMatchStreamResultEvent
  | EanCategoryMatchStreamDoneEvent;

/**
 * Cancellation input, shared by the streaming capability and the service.
 *
 * An aborted signal stops further work from being *scheduled*; an in-flight
 * marketplace call is left to settle (ADR-047 § Consequences) - tearing it down
 * would spend the operator's rate-limit budget for a result nobody reads while
 * still paying for the request.
 */
export interface EanCategoryMatchStreamOptions {
  signal?: AbortSignal;
}
