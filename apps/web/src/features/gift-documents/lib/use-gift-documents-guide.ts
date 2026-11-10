/**
 * Gift documents guide
 *
 * The sections of the "How a gift gets on the document" guide, built from the
 * locale copy. Item ids are what the page's `HelpHint`s point at.
 *
 * @module apps/web/src/features/gift-documents/lib
 */
import { useMessages } from '../../../shared/i18n';
import type { GuideSection } from '../../../shared/ui/guide-drawer';

export function useGiftDocumentsGuide(): { title: string; lede: string; sections: GuideSection[] } {
  const copy = useMessages('gift-documents').settings;
  const guide = copy.guide;
  return {
    title: copy.guideTitle,
    lede: copy.guideLede,
    sections: [
      {
        id: 's-forms',
        number: guide.forms.number,
        title: guide.forms.title,
        summary: guide.forms.summary,
        defaultOpen: true,
        items: [
          { id: 'g-form', name: guide.forms.itemForm, text: guide.forms.formText },
          { id: 'g-sum', name: guide.forms.itemSum, text: guide.forms.sumText },
        ],
      },
      {
        id: 's-prec',
        number: guide.precedence.number,
        title: guide.precedence.title,
        summary: guide.precedence.summary,
        items: [{ id: 'g-prec', name: guide.precedence.item, text: guide.precedence.text }],
      },
      {
        id: 's-prov',
        number: guide.providers.number,
        title: guide.providers.title,
        summary: guide.providers.summary,
        items: [{ id: 'g-prov', name: guide.providers.item, text: guide.providers.text }],
      },
      {
        id: 's-bundle',
        number: guide.bundles.number,
        title: guide.bundles.title,
        summary: guide.bundles.summary,
        items: [{ id: 'g-bundle', name: guide.bundles.item, text: guide.bundles.text }],
      },
      {
        id: 's-new',
        number: guide.since.number,
        title: guide.since.title,
        summary: guide.since.summary,
        items: [{ id: 'g-new', name: guide.since.item, text: guide.since.text }],
      },
    ],
  };
}
