/**
 * Stock movement history - help guide (#4061)
 *
 * Turns the guide copy into ordered sections with stable entry ids, so a row
 * badge, a panel link and the drawer's search all point at the same entry.
 * The words live in `inventory.stockHistory.guide`; this file owns only the
 * order and the ids.
 *
 * @module apps/web/src/features/inventory/lib
 */
import type { StockGuideId, StockHistoryCopy } from './stock-movement-view-model';

export type GuideSectionId = 'numbers' | 'states' | 'kinds';

export interface GuideEntry {
  id: StockGuideId;
  title: string;
  body: string;
  todo?: string;
  /** States render as the badge a row shows, so the guide matches the list. */
  badgeTone?: 'error' | 'warning' | 'info';
}

export interface GuideSection {
  id: GuideSectionId;
  title: string;
  summary: string;
  entries: GuideEntry[];
}

const SECTION_ORDER: readonly GuideSectionId[] = ['numbers', 'states', 'kinds'];

const ENTRY_ORDER = {
  numbers: ['amount', 'onHand', 'reserved', 'available', 'startingCount'],
  states: ['refused', 'inDoubt', 'pending'],
  kinds: ['sale', 'cancellation', 'return', 'correction', 'shopChange', 'hold'],
} as const;

const STATE_TONE = { refused: 'error', inDoubt: 'warning', pending: 'info' } as const;

export function buildStockGuide(copy: StockHistoryCopy): GuideSection[] {
  const sections = copy.guide.sections;
  return SECTION_ORDER.map((sectionId) => {
    const section = sections[sectionId];
    const items = section.items as Record<string, { title: string; body: string; todo?: string }>;
    const entries = ENTRY_ORDER[sectionId].map((key): GuideEntry => {
      const item = items[key];
      return {
        id: `${sectionId}.${key}` as StockGuideId,
        title: item.title,
        body: item.body,
        todo: item.todo,
        badgeTone: sectionId === 'states' ? STATE_TONE[key as keyof typeof STATE_TONE] : undefined,
      };
    });
    return { id: sectionId, title: section.title, summary: section.summary, entries };
  });
}

export function guideSectionOf(id: StockGuideId): GuideSectionId {
  return id.split('.')[0] as GuideSectionId;
}

/** Case- and diacritic-insensitive, so "rezerw" finds "Zarezerwowane". */
export function normalizeGuideQuery(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function matchesGuideQuery(entry: GuideEntry, query: string): boolean {
  if (query === '') return true;
  return normalizeGuideQuery([entry.title, entry.body, entry.todo ?? ''].join(' ')).includes(query);
}
