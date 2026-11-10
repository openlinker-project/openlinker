/**
 * Gift report guide
 *
 * The sections of "How we count the cost", built from the locale copy.
 *
 * @module features/gift-report/lib
 */
import { useMessages } from '../../../shared/i18n';
import type { GuideSection } from '../../../shared/ui/guide-drawer';

export function useGiftReportGuide(): { title: string; lede: string; sections: GuideSection[] } {
  const copy = useMessages('gift-report').guide;
  return {
    title: copy.title,
    lede: copy.lede,
    sections: [
      {
        id: 's-cost',
        number: '01',
        title: copy.cost.title,
        summary: copy.cost.summary,
        defaultOpen: true,
        items: [
          { id: 'g-cost', name: copy.cost.itemCost, text: copy.cost.costText },
          { id: 'g-unk', name: copy.cost.itemUnknown, text: copy.cost.unknownText },
        ],
      },
      {
        id: 's-src',
        number: '02',
        title: copy.source.title,
        summary: copy.source.summary,
        items: [{ id: 'g-src', name: copy.source.item, text: copy.source.text }],
      },
      {
        id: 's-bun',
        number: '03',
        title: copy.bundles.title,
        summary: copy.bundles.summary,
        items: [{ id: 'g-bun', name: copy.bundles.item, text: copy.bundles.text }],
      },
      {
        id: 's-csv',
        number: '04',
        title: copy.csv.title,
        summary: copy.csv.summary,
        items: [{ id: 'g-csv', name: copy.csv.item, text: copy.csv.text }],
      },
    ],
  };
}
