/**
 * Sync Guide (#4024)
 *
 * The "How to read this" guide: section order and per-entry metadata live
 * here, the words live in the `cursors` namespace (`syncGuide.*`), because a
 * translation file carries no arrays and no order. The page and the guide share
 * these ids, so a badge or a column header can open the guide on its own entry.
 *
 * @module apps/web/src/features/cursors/lib
 */
import type { Messages } from '../../../shared/i18n';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

interface ItemMeta {
  id: string;
  badge?: StatusBadgeTone;
  everyMinutes?: number;
  canStartOver?: boolean;
  key?: string;
}

const LAYOUT: readonly { id: string; items: readonly ItemMeta[] }[] = [
  {
    id: 'health',
    items: [
      { id: 'h-ok', badge: 'success' },
      { id: 'h-late', badge: 'warning' },
      { id: 'h-stuck', badge: 'warning' },
      { id: 'h-failing', badge: 'error' },
      { id: 'h-misplaced', badge: 'error' },
      { id: 'h-pushes', badge: 'neutral' },
      { id: 'h-plain', badge: 'neutral' },
    ],
  },
  {
    id: 'progress',
    items: [
      { id: 'p-readupto' },
      { id: 'p-inprogress' },
      { id: 'p-finished' },
      { id: 'p-notstarted' },
      { id: 'p-checked' },
      { id: 'p-stock' },
    ],
  },
  {
    id: 'kinds',
    items: [
      { id: 'k-event-bookmark' },
      { id: 'k-rolling-offset' },
      { id: 'k-sweep-cycle' },
      { id: 'k-completion-stamp' },
      { id: 'k-write-order' },
    ],
  },
  {
    id: 'syncs',
    items: [
      {
        id: 's-orders',
        everyMinutes: 5,
        key: 'allegro.orders.lastEventId, erli.orders.inboxCursor',
      },
      { id: 's-changed-orders', everyMinutes: 10, key: 'prestashop.orders.dateUpd' },
      { id: 's-offer-changes', everyMinutes: 15, key: 'allegro.offers.lastEventId' },
      { id: 's-returns', everyMinutes: 30, key: 'allegro.customerReturns.lastReturnId' },
      {
        id: 's-returns-check',
        everyMinutes: 60,
        canStartOver: true,
        key: 'allegro.customerReturns.scanOffset',
      },
      {
        id: 's-listing-status',
        everyMinutes: 60,
        canStartOver: true,
        key: '*.offerStatus.scanOffset',
      },
      { id: 's-parcel', everyMinutes: 15, canStartOver: true, key: '*.shipmentStatus.scanOffset' },
      {
        id: 's-shop-status',
        everyMinutes: 30,
        canStartOver: true,
        key: '*.fulfillmentStatus.scanOffset',
      },
      {
        id: 's-catalogue',
        everyMinutes: 20,
        canStartOver: true,
        key: 'master.product.sweep:connection:…',
      },
      {
        id: 's-stock',
        everyMinutes: 15,
        canStartOver: true,
        key: 'master.inventory.sweep:connection:…',
      },
      {
        id: 's-deleted',
        everyMinutes: 60,
        canStartOver: true,
        key: 'master.product-reconcile.sweep:connection:…',
      },
      { id: 's-categories', key: 'destination.taxonomy.frontier:…' },
      {
        id: 's-system',
        key: 'automation.deadlineSweep.scanOffset, inventory.reservationShortfall.*',
      },
    ],
  },
  {
    id: 'actions',
    items: [{ id: 'a-run' }, { id: 'a-fetch' }, { id: 'a-history' }, { id: 'a-keys' }],
  },
  {
    id: 'faq',
    items: [
      { id: 'q-empty' },
      { id: 'q-nobookmarks' },
      { id: 'q-late-ok' },
      { id: 'q-safe' },
      { id: 'q-alert' },
      { id: 'q-unknown' },
    ],
  },
];

export interface SyncGuideItem extends ItemMeta {
  name: string;
  text: string;
  how?: string;
  todo?: string;
}

export interface SyncGuideSection {
  id: string;
  title: string;
  summary: string;
  items: readonly SyncGuideItem[];
}

type GuideCopy = Messages['cursors']['syncGuide'];
type ItemCopy = { name: string; text: string; how?: string; todo?: string };

export function buildSyncGuide(copy: GuideCopy): SyncGuideSection[] {
  const sections = copy.sections as Record<string, { title: string; summary: string }>;
  const items = copy.items as Record<string, ItemCopy>;
  return LAYOUT.map((section) => ({
    id: section.id,
    title: sections[section.id].title,
    summary: sections[section.id].summary,
    items: section.items.map((meta) => ({ ...meta, ...items[meta.id] })),
  }));
}
