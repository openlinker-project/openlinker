/**
 * GiftsGuide (#3935)
 *
 * The "How gifts and bundles work" button and its drawer for the surfaces that
 * carry gifts or bundles (orders list and detail, return detail, pack bench,
 * stock movements). The words are per variant in the `gifts` namespace; the
 * mechanics (button, drawer, `?` key) are the shared `PageGuide` and
 * `GuideButton`.
 *
 * @module apps/web/src/features/gifts/components
 */
import { useMemo, type ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { GuideButton, PageGuide, type GuideSection } from '../../../shared/ui/guide-drawer';

export type GiftsGuideVariant = 'list' | 'detail' | 'returns' | 'bench' | 'stock';

export interface GiftsGuideProps {
  variant: GiftsGuideVariant;
}

export function GiftsGuide({ variant }: GiftsGuideProps): ReactElement {
  const copy = useMessages('gifts').guide;
  const text = copy.variants[variant];
  const sections = useMemo<GuideSection[]>(
    () =>
      Object.entries(text.sections).map(([id, section], index) => ({
        id: `gifts-${variant}-${id}`,
        number: String(index + 1).padStart(2, '0'),
        title: section.title,
        summary: section.tag,
        items: [],
        extra: (
          <div className="pm-gitem">
            {Object.entries(section)
              .filter(([key]) => /^p\d+$/.test(key))
              .map(([key, paragraph]) => (
                <p key={key}>{paragraph}</p>
              ))}
          </div>
        ),
      })),
    [text, variant],
  );
  const firstId = sections[0]?.id;

  return (
    <PageGuide
      title={text.title}
      lede={text.intro}
      sections={sections}
      {...(firstId === undefined ? {} : { defaultOpen: [firstId] })}
    >
      <GuideButton label={text.button} data-testid="gifts-guide-open" />
    </PageGuide>
  );
}
