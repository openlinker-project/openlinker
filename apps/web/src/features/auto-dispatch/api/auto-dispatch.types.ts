/**
 * Automatic shipping labels - API types (#2729 backend, #3572 screen)
 *
 * The browser cannot import `@openlinker/core` (#591), so the closed
 * vocabularies the backend answers with are mirrored here. They are all
 * parsed on the way in (`auto-dispatch.schema.ts`): a code this build does not
 * know reads as `unknown` rather than rendering a blank.
 *
 * @module apps/web/src/features/auto-dispatch/api
 */

/** When the label is bought. The first is also what an absent value reads as. */
export const AutoDispatchTriggerValues = ['on-accept', 'on-parcel-closed'] as const;
export type AutoDispatchTrigger = (typeof AutoDispatchTriggerValues)[number];

export const AutoDispatchRefusalBucketValues = ['needs-input', 'retrying'] as const;
export type AutoDispatchRefusalBucket = (typeof AutoDispatchRefusalBucketValues)[number];

/** The reason codes the refusal read can carry; anything else parses to `unknown`. */
export const AutoDispatchRefusalCodeValues = [
  'not-enabled',
  'no-weight',
  'no-dimensions',
  'no-address',
  'no-delivery-method',
  'work-not-eligible',
  'shipment-claimed-by-sibling-work',
  'payload-invalid',
  'carrier-refused',
  'unknown',
] as const;
export type AutoDispatchRefusalCode = (typeof AutoDispatchRefusalCodeValues)[number];

/** Why the preview would refuse an order, or `null` for one that would get a label. */
export const AutoDispatchPreviewRefusalValues = [
  'no-weight',
  'no-address',
  'no-dimensions',
  'order-unreadable',
] as const;
export type AutoDispatchPreviewRefusal = (typeof AutoDispatchPreviewRefusalValues)[number];

/** The connection the settings belong to; it is often the OMS or a 3PL, not a carrier. */
export interface AutoDispatchHolder {
  readonly connectionId: string;
  readonly name: string;
  readonly platformType: string;
  readonly holdsWork: boolean;
  readonly autoDispatchEnabled: boolean;
}

export interface AutoDispatchRefusal {
  readonly jobId: string;
  readonly workId: string | null;
  readonly orderId: string | null;
  readonly code: AutoDispatchRefusalCode;
  readonly bucket: AutoDispatchRefusalBucket;
  readonly since: string;
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface AutoDispatchRefusals {
  readonly holder: AutoDispatchHolder;
  readonly needsInput: readonly AutoDispatchRefusal[];
  readonly retrying: readonly AutoDispatchRefusal[];
}

export interface AutoDispatchPreviewItem {
  readonly workId: string;
  readonly orderId: string;
  readonly weightGrams: number | null;
  readonly template: string | null;
  readonly dimensions: {
    readonly length: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly refusal: AutoDispatchPreviewRefusal | null;
}

export interface AutoDispatchPreview {
  readonly holder: AutoDispatchHolder;
  readonly items: readonly AutoDispatchPreviewItem[];
}

/** The draft settings a preview is computed against. Nothing here is saved. */
export interface AutoDispatchPreviewRequest {
  readonly parcelTemplate?: string;
  readonly defaultWeightGrams?: number;
  readonly lengthMm?: number;
  readonly widthMm?: number;
  readonly heightMm?: number;
  readonly limit?: number;
}
