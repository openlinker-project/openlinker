/**
 * Bulk wizard internal types
 *
 * Co-located row + step types used only inside the wizard subtree.
 * Public BE transport types live in `../api/bulk-listings.types.ts`.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { Product, ProductVariant } from '../../../products';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';

export const BulkWizardStepValues = [
  'config',
  'resolve',
  'review',
  'confirm',
] as const;
export type BulkWizardStep = (typeof BulkWizardStepValues)[number];

export const BulkRowStatusValues = [
  // Background resolves are still running for this row.
  'resolving',
  // EAN→category lookup succeeded; row is ready for submit.
  'matched',
  // 15s budget exhausted, query still in flight; will auto-flip to matched
  // when it settles.
  'pending-after-timeout',
  // No EAN on the variant → operator must pick a category manually.
  'no-ean',
  // No primary variant on the product → cannot bulk-list this product.
  'no-variant',
  // EAN present but Allegro returned no match.
  'no-match',
] as const;
export type BulkRowStatus = (typeof BulkRowStatusValues)[number];

export interface BulkWizardRow {
  productId: string;
  /** Hydrated when products query resolves; null while loading or on 404. */
  product: Product | null;
  /** Primary variant (variants[0]). Null when product has no variants. */
  primaryVariant: ProductVariant | null;
  status: BulkRowStatus;
  /** Resolved Allegro category id (after Step 2). */
  resolvedCategoryId: string | null;
  /** How the category was resolved (telemetry / UI hint). */
  resolutionMethod: 'auto_detect' | 'category_mapping' | 'manual' | null;
  /** Per-row overrides written by the edit modal. Sent on bulk submit. */
  override: BulkPerProductOverride;
  /**
   * FE-only stash of the edit-modal's React Hook Form values so reopening
   * the modal restores entered values. Strictly internal; never forwarded
   * on the wire (the wizard's submit only reads `override`).
   */
  editFormValues?: Record<string, unknown>;
}

export interface BulkWizardConfig {
  connectionId: string;
  /** Allegro delivery policy ID. */
  deliveryPolicyId: string;
  defaultStock: number;
  publishImmediately: boolean;
  generateDescription: boolean;
  /** Optional default price applied to every row that doesn't have a product-side price. */
  defaultPrice?: { amount: number; currency: string };
}

/** Status filter set after Step 2 — used by the review-step gate logic. */
export const READY_ROW_STATUSES: readonly BulkRowStatus[] = ['matched'];
