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
 * Runtime array of the stream-event discriminants. Required by
 * `engineering-standards.md § Union Types: as const Pattern`; the transport
 * work (epic #2205 step 4) validates an inbound line against it, so the
 * runtime array has to exist before that lands.
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
 * Terminal event, emitted exactly once and always last.
 *
 * `resolvedCount` counts variants that reached a single destination category
 * (`matched`); `failedCount` counts every other outcome (`multi-match`,
 * `no-ean`, `no-match`) - i.e. the variants still needing operator action.
 * The two are reported separately rather than as one progress number because a
 * consumer has to distinguish "the run finished, act on N rows" from "the run
 * finished, nothing to do". They sum to the number of `result` events actually
 * emitted, which is below the input size only on an aborted stream.
 */
export interface EanCategoryMatchStreamDoneEvent {
  kind: 'done';
  resolvedCount: number;
  failedCount: number;
}

export type EanCategoryMatchStreamEvent =
  | EanCategoryMatchStreamResultEvent
  | EanCategoryMatchStreamDoneEvent;

/**
 * Cancellation input, shared by the streaming capability and the service.
 *
 * An aborted signal stops further work from being *scheduled*; an in-flight
 * marketplace call is left to settle (epic #2205 decision 5) - tearing it down
 * would spend the operator's rate-limit budget for a result nobody reads while
 * still paying for the request.
 */
export interface EanCategoryMatchStreamOptions {
  signal?: AbortSignal;
}
