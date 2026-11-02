/**
 * G11 mockup page object (#3591)
 *
 * Drives the two repo-committed G11 mockups straight off disk, never the
 * Artifact URL (`docs/frontend-architecture.md` § UX Mockups). The state
 * switching is the shared `ol-kit.js` mechanism the G03 mockups use, so the
 * navigation itself is reused from `OmsMvpG03MockupPage`.
 *
 * `MOCKUP_TESTIDS` is what each mockup state really declares, read from the
 * committed files; `MOCKUP_ONLY` lists the ids the mockup draws that the
 * shipped screens intentionally do not carry (state wrappers, and controls the
 * implementation replaced), so the live comparison names them rather than
 * hiding them.
 *
 * @module pages
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OmsMvpG03MockupPage } from './oms-mvp-g03-mockup.page';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCKUP_ROOT = resolve(HERE, '../../../../docs/plans/mockups/oms-mvp');

export const G11_MOCKUP_FILES = {
  m26: resolve(MOCKUP_ROOT, 'm26-variant-images-cost-and-margin.html'),
  m30: resolve(MOCKUP_ROOT, 'm30-missing-cost-prices.html'),
} as const;

export const M26_STATES = [
  'variant-images',
  'cost-edit',
  'margin',
  'missing-cost',
  'export-preparing',
  'export-ready',
  'export-failed',
  'viewer',
] as const;
export type M26State = (typeof M26_STATES)[number];

export const M30_STATES = [
  'products-banner',
  'worklist',
  'bulk',
  'analytics',
  'insights',
  'order-line',
  'done',
  'viewer',
  'off',
] as const;
export type M30State = (typeof M30_STATES)[number];

/** Test ids each mockup state declares inside its own section. */
export const MOCKUP_TESTIDS = {
  m26: {
    'variant-images': ['variant-images-state', 'variant-table-section'],
    'cost-edit': ['variant-cost-edit-state'],
    margin: ['margin-state'],
    'missing-cost': [
      'margin-missing-cost-state',
      'margin-panel',
      'margin-missing-cost-empty',
      'margin-missing-cost-list',
      'export-csv-margin-channel',
    ],
    'export-preparing': ['export-preparing-state'],
    'export-ready': ['export-ready-state', 'export-status', 'export-dismiss', 'export-csv-sample'],
    'export-failed': ['export-failed-state'],
    viewer: ['variant-viewer-state'],
  },
  m30: {
    'products-banner': [
      'cost-banner-products-state',
      'cost-coverage-banner',
      'cost-coverage-banner-open',
      'cost-coverage-banner-dismiss',
      'products-filter-no-cost',
      'products-open-cost-prices',
    ],
    worklist: ['cost-worklist-state'],
    bulk: [
      'cost-worklist-bulk-state',
      'cost-bulk-dialog',
      'cost-bulk-input',
      'cost-bulk-currency',
      'cost-bulk-preview',
      'cost-bulk-save',
      'cost-bulk-cancel',
      'cost-bulk-error',
    ],
    analytics: [
      'cost-banner-analytics-state',
      'cost-coverage-banner',
      'cost-coverage-banner-margin',
      'cost-coverage-banner-open',
      'margin-kpi-margin-pct',
    ],
    insights: ['cost-insights-state', 'insights-setup-gaps', 'insights-gap-cost-price', 'insights-gap-cost-price-open'],
    'order-line': [
      'cost-order-line-state',
      'order-items-cost-table',
      'order-line-no-cost',
      'order-line-add-cost',
      'order-line-cost-note',
    ],
    done: ['cost-worklist-done-state'],
    viewer: ['cost-worklist-viewer-state'],
    off: [
      'cost-tracking-off-state',
      'settings-margin-tracking',
      'settings-margin-tracking-toggle',
      'settings-margin-tracking-save',
    ],
  },
} as const;

/**
 * Ids the mockup carries that the shipped screens do not, with the reason. The
 * live-testid spec treats these as expected differences and records each as an
 * annotation, so a reviewer sees the divergence instead of a quiet omission.
 */
export const MOCKUP_ONLY: Record<string, string> = {
  'variant-photo-bench-preview': 'the bench preview is a design annotation; the bench renders the thumbnail (bench-parcel-line-thumb)',
  'margin-coverage-show-variants': 'the live note lists reasons in margin-coverage-details; per-variant links live on the missing-cost list',
  'analytics-date-from': 'the live toolbar identifies the date inputs by aria-label ("Order date from")',
  'analytics-date-to': 'the live toolbar identifies the date inputs by aria-label ("Order date to")',
  'analytics-apply': 'the live toolbar applies on change, there is no Apply button',
  'analytics-vat-basis': 'the live VAT basis switch is analytics-net-gross-toggle',
  'analytics-display-currency': 'the live display-currency control is labelled "Display currency"',
  'export-dismiss': 'the live export starts a browser download; there is no toast to dismiss',
  'export-csv-sample': 'file preview is a design annotation',
  'settings-margin-tracking-save': 'the live toggle saves on change, there is no Save button',
};

export class OmsMvpG11MockupPage extends OmsMvpG03MockupPage {}
