/**
 * Sync Guide Copy (#4024)
 *
 * Everything the "How to read this" guide explains, in one table. The page
 * and the guide share these ids, so a badge or a column header can open the
 * guide on its own explanation.
 *
 * @module apps/web/src/features/cursors/lib
 */
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

export interface SyncGuideItem {
  id: string;
  name: string;
  /** Rendered as a badge instead of a plain name. */
  badge?: { tone: StatusBadgeTone; label: string };
  text: string;
  how?: string;
  todo?: string;
  everyMinutes?: number;
  canStartOver?: boolean;
  key?: string;
}

export interface SyncGuideSection {
  id: string;
  title: string;
  summary: string;
  items: readonly SyncGuideItem[];
}

export const SYNC_GUIDE_CHROME = {
  title: 'How to read sync progress',
  description: 'Explains every status, progress line, sync and action on the Sync progress page.',
  searchLabel: 'Search the guide',
  searchPlaceholder: 'Search the guide: empty, late, token…',
  introBookmark: 'A sync bookmark',
  intro1: ' is how far a sync got last time. The next run starts from there, so nothing is read twice and nothing is skipped.',
  intro2: 'Each row is one sync for one connection. Health tells you whether it keeps to its schedule. Progress tells you where it is.',
  shownWhen: (how: string): string => `Shown when: ${how}`,
  whatToDo: 'What to do:',
  runsEvery: (n: number): string => `Runs every ${n} min`,
  canStartOver: 'Can start over',
  found: (n: number): string => `${n} found`,
  nothingFound: (q: string): string => `Nothing in the guide matches “${q}”.`,
  footer: 'Press ? anywhere on this page to open the guide, Esc to close it.',
} as const;

export const SYNC_GUIDE: readonly SyncGuideSection[] = [
  {
    id: 'health',
    title: 'Health',
    summary: 'What the badges mean',
    items: [
      { id: 'h-ok', name: 'On time', badge: { tone: 'success', label: 'On time' }, text: 'The sync moved recently enough for its schedule. Nothing to do.', how: 'Moved within 2× its normal interval.' },
      { id: 'h-late', name: 'Late', badge: { tone: 'warning', label: 'Late' }, text: 'The sync is behind its schedule but still within reach. Often a busy queue or a slow shop.', how: 'Not moved for 2× to 6× its normal interval.', todo: 'Wait one more interval. If it stays late, open the run history.' },
      { id: 'h-stuck', name: 'Not moving', badge: { tone: 'warning', label: 'Not moving' }, text: 'The sync has not moved for a long time. Orders or stock from this source may be missing in OpenLinker.', how: 'Not moved for more than 6× its normal interval.', todo: 'Open the run history to see why. Check the connection is enabled and its scheduled task is on. Then use Run now.' },
      { id: 'h-failing', name: 'Failing', badge: { tone: 'error', label: 'Failing' }, text: 'The last run ended with an error. The bookmark stays where it was, so nothing is skipped. It continues once the error is fixed.', how: 'The latest run for this sync failed.', todo: 'Read the error in the details. An expired token is fixed by reconnecting the account on the connection page.' },
      { id: 'h-misplaced', name: 'Wrong connection', badge: { tone: 'error', label: 'Wrong connection' }, text: 'This bookmark belongs to a different platform than the connection it sits on. A sync was run against the wrong connection, so its progress is not trustworthy.', how: 'The bookmark name names one platform, the connection is another.', todo: 'Report it to whoever maintains your installation. Do not start it over on this connection.' },
      { id: 'h-pushes', name: 'Pushes changes', badge: { tone: 'neutral', label: 'Pushes changes' }, text: 'The connection sends every change to OpenLinker the moment it happens, so there is no bookmark to keep. An empty list here is normal.', todo: 'If changes stop arriving, check the webhook on the connection page.' },
      { id: 'h-plain', name: 'OK', badge: { tone: 'neutral', label: 'OK' }, text: 'A bookmark with no schedule of its own, such as the stock write order. It is never late.' },
    ],
  },
  {
    id: 'progress',
    title: 'Progress',
    summary: 'How to read the middle column',
    items: [
      { id: 'p-readupto', name: 'Read up to (time)', text: 'Everything the platform reported before this moment is already in OpenLinker. The next run asks only for what came after.' },
      { id: 'p-inprogress', name: 'In progress: N items done', text: 'A long pass through the catalogue is part way through. Big catalogues take several runs, so one pass can span hours. It continues on the next run on its own.' },
      { id: 'p-finished', name: 'Finished, waiting for next pass', text: 'The last pass went through the whole catalogue. The bookmark is cleared on purpose and the raw value is empty. This is the normal resting state, not an error.' },
      { id: 'p-notstarted', name: 'Not started yet', text: 'This sync has never read anything. Normal for a new connection, or for a feature switched on recently. If it stays like this, look at its health badge.' },
      { id: 'p-checked', name: 'Checked up to item N', text: 'A re-check that walks through items OpenLinker already knows, one page per run, and starts again from the top when it reaches the end.' },
      { id: 'p-stock', name: 'Stock sent to N listings', text: 'One entry per listing, recording the newest stock number sent there. An older number arriving late is refused, so a slow job can never put old stock back on a listing.' },
    ],
  },
  {
    id: 'kinds',
    title: 'Kinds of bookmark',
    summary: '5 kinds',
    items: [
      { id: 'k-event-bookmark', name: 'Reads new events from a feed', text: 'When the raw value is empty: nothing has been read yet. The next run starts from the beginning of the feed or from the connection start date.' },
      { id: 'k-rolling-offset', name: 'Re-checks known items, one page per run', text: 'When the raw value is empty: not run yet, or it just wrapped around. The next run starts at the first item.' },
      { id: 'k-sweep-cycle', name: 'Goes through the whole catalogue over several runs', text: 'When the raw value is empty: the last pass finished. This is the normal resting state between passes.' },
      { id: 'k-completion-stamp', name: 'Remembers when a pass finished', text: 'Shown inside the catalogue row as “Last pass done”, not as a row of its own.' },
      { id: 'k-write-order', name: 'Keeps older stock numbers from overwriting newer ones', text: 'When the raw value is empty: no stock written to this listing yet.' },
    ],
  },
  {
    id: 'syncs',
    title: 'Every sync on this page',
    summary: '11 syncs',
    items: [
      { id: 's-orders', name: 'New orders', key: 'allegro.orders.lastEventId, erli.orders.inboxCursor', everyMinutes: 5, text: 'Reads new and changed orders from the marketplace feed and creates them in OpenLinker.' },
      { id: 's-changed-orders', name: 'Changed orders (backup check)', key: 'prestashop.orders.dateUpd', everyMinutes: 10, text: 'The shop normally sends orders by webhook. This check reads every order changed after the time shown, to catch anything a webhook missed.' },
      { id: 's-offer-changes', name: 'Offer changes', key: 'allegro.offers.lastEventId', everyMinutes: 15, text: 'Reads changes to your Allegro offers, such as an offer ended or edited on Allegro, so OpenLinker shows the same state.' },
      { id: 's-returns', name: 'New returns', key: 'allegro.customerReturns.lastReturnId', everyMinutes: 30, text: 'Reads returns buyers open on Allegro. Off by default, because the Allegro returns feed is still in beta.' },
      { id: 's-returns-check', name: 'Open returns check', key: 'allegro.customerReturns.scanOffset', everyMinutes: 60, canStartOver: true, text: 'Re-reads returns that are still open, one page per run, to pick up status changes.' },
      { id: 's-listing-status', name: 'Listing status check', key: '*.offerStatus.scanOffset', everyMinutes: 60, canStartOver: true, text: 'Re-reads whether each listing is active, ended or blocked on the marketplace, one page per run.' },
      { id: 's-parcel', name: 'Parcel tracking check', key: '*.shipmentStatus.scanOffset', everyMinutes: 15, canStartOver: true, text: 'Re-reads the tracking status of parcels on the way, one page per run.' },
      { id: 's-shop-status', name: 'Shop order status check', key: 'prestashop.fulfillmentStatus.scanOffset', everyMinutes: 30, canStartOver: true, text: 'Re-reads the order status in the shop so a shipment marked there shows up in OpenLinker.' },
      { id: 's-catalogue', name: 'Product catalogue', key: 'master.product.sweep:connection:…', everyMinutes: 20, canStartOver: true, text: 'Reads every product from your master catalogue, a batch per run, so names, prices and variants stay current.' },
      { id: 's-stock', name: 'Stock levels', key: 'master.inventory.sweep:connection:…', everyMinutes: 15, canStartOver: true, text: 'Reads stock for every product from your master catalogue, a batch per run. Changes go on to your marketplaces.' },
      { id: 's-deleted', name: 'Deleted products check', key: 'master.product-reconcile.sweep:connection:…', everyMinutes: 60, canStartOver: true, text: 'Looks for products deleted in your catalogue, so their listings stop selling.' },
      { id: 's-system', name: 'System checks', key: 'automation.deadlineSweep.scanOffset, inventory.reservationShortfall.*', text: 'Checks that run across all connections, such as automation deadlines and stock shortfalls. They are listed under System.' },
    ],
  },
  {
    id: 'actions',
    title: 'Actions',
    summary: 'What each button does',
    items: [
      { id: 'a-run', name: 'Run now', text: 'Queues this sync to run straight away instead of waiting for its schedule. It continues from the bookmark, so nothing is read twice.' },
      { id: 'a-fetch', name: 'Fetch again', text: 'Puts a catalogue pass or a re-check back at the start, so the next run reads everything again. Order feeds cannot be moved back: their position is kept in the platform’s own format.', todo: 'Starting a pass over is blocked while a run is in progress.' },
      { id: 'a-history', name: 'View run history', text: 'Opens the list of runs for this connection, with the error of every failed run.' },
      { id: 'a-keys', name: 'Show technical keys', text: 'Shows the internal name of each bookmark under its label. Useful when talking to support or reading logs. The raw value is always in Technical details inside each row.' },
    ],
  },
  {
    id: 'faq',
    title: 'Common questions',
    summary: '6 answers',
    items: [
      { id: 'q-empty', name: 'Why is a value empty?', text: 'For a catalogue pass, empty means the pass finished. That is the normal state between passes. For any other sync it means nothing has been read yet.' },
      { id: 'q-nobookmarks', name: 'Why does a connection have no bookmarks?', text: 'Connections that push changes to OpenLinker as they happen need no bookmark. Their list is empty by design.' },
      { id: 'q-late-ok', name: 'Last run was OK, so why is it Not moving?', text: 'The run succeeded but found nothing new and did not advance, or it ran on a different schedule than expected. Check that the scheduled task for this sync is switched on.' },
      { id: 'q-safe', name: 'Is Fetch again safe?', text: 'Yes. Starting a re-check over only reads. Starting a catalogue pass over re-reads every product, which adds load on the shop for a few runs, and writes nothing twice.' },
      { id: 'q-alert', name: 'Will I be told when a sync stops?', text: 'Not yet. Today the “needs a look” box on this page is the signal. Check it after an outage or when orders seem to be missing.' },
      { id: 'q-unknown', name: 'What is an unrecognised bookmark?', text: 'A bookmark this version of OpenLinker has no description for, usually from a plugin. It works normally; the page just cannot explain it.' },
    ],
  },
];

export type SyncGuideItemId = string;
