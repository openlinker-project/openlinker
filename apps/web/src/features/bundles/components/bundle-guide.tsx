/**
 * Bundle guide (#3520)
 *
 * The "How bundles work" reference drawer shared by the bundle form, the bundle
 * product page, the products list and the offer wizard. Content lives in the
 * `bundles.guide` locale namespace. `BundleGuide` wraps a page with the shared
 * `GuideProvider` (which owns the drawer and the `?` shortcut); `BundleGuideButton`
 * is the header button that opens it.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useMemo, type ReactElement, type ReactNode } from 'react';
import { useMessages } from '../../../shared/i18n';
import { GuideProvider, useGuide, type GuideContent } from '../../../shared/ui/guide-drawer';

export function BundleGuide({
  children,
  defaultOpen = 'what',
}: {
  children: ReactNode;
  /** Section open first: `what`, `avail`, `gift`, `ver`, `new` or `offer`. */
  defaultOpen?: string;
}): ReactElement {
  const g = useMessages('bundles').guide;
  const content = useMemo<GuideContent>(() => {
    const item = (
      id: string,
      name: string,
      body: string
    ): GuideContent['sections'][number]['items'][number] => ({
      id,
      name,
      body,
    });
    return {
      eyebrow: g.eyebrow,
      title: g.title,
      lede: g.lede,
      closeLabel: g.close,
      footer: g.footer,
      defaultOpen: [defaultOpen],
      sections: [
        {
          id: 'what',
          number: '01',
          title: g.what.title,
          summary: g.what.summary,
          items: [item('g-what', g.what.i1n, g.what.i1t), item('g-price', g.what.i2n, g.what.i2t)],
        },
        {
          id: 'avail',
          number: '02',
          title: g.avail.title,
          summary: g.avail.summary,
          items: [item('g-avail', g.avail.i1n, g.avail.i1t)],
          extra: (
            <ol className="pm-flow" aria-label={g.exampleLabel}>
              {[
                { n: g.avail.e1n, d: g.avail.e1d, s: g.avail.e1s, hit: false },
                { n: g.avail.e2n, d: g.avail.e2d, s: g.avail.e2s, hit: true },
                { n: g.avail.e3n, d: g.avail.e3d, s: g.avail.e3s, hit: false },
              ].map((step, index) => (
                <li key={step.n} className={step.hit ? 'is-hit' : undefined}>
                  <span className="pm-flow__n">{index + 1}</span>
                  <span>
                    {step.n}
                    <small>{step.d}</small>
                  </span>
                  <span className="mono tabular">{step.s}</span>
                </li>
              ))}
            </ol>
          ),
        },
        {
          id: 'gift',
          number: '03',
          title: g.gift.title,
          summary: g.gift.summary,
          items: [item('g-gift', g.gift.i1n, g.gift.i1t)],
        },
        {
          id: 'ver',
          number: '04',
          title: g.ver.title,
          summary: g.ver.summary,
          items: [item('g-ver', g.ver.i1n, g.ver.i1t)],
        },
        {
          id: 'new',
          number: '05',
          title: g.new.title,
          summary: g.new.summary,
          items: [item('g-new', g.new.i1n, g.new.i1t), item('g-steps', g.new.i2n, g.new.i2t)],
        },
        {
          id: 'offer',
          number: '06',
          title: g.offer.title,
          summary: g.offer.summary,
          items: [item('g-offer', g.offer.i1n, g.offer.i1t)],
        },
      ],
    };
  }, [g, defaultOpen]);
  return <GuideProvider content={content}>{children}</GuideProvider>;
}

/** The header button that opens the guide (must sit inside a `BundleGuide`). */
export function BundleGuideButton({ entry }: { entry?: string }): ReactElement {
  const openGuide = useGuide();
  const label = useMessages('bundles').guide.trigger;
  return (
    <button
      type="button"
      className="button button--secondary button--sm pm-helpbtn"
      onClick={() => {
        openGuide?.(entry ?? null);
      }}
      data-testid="bundle-guide-button"
    >
      <span className="pm-qmark" aria-hidden="true">
        ?
      </span>
      {label}
      <span className="button__shortcut" aria-hidden="true">
        ?
      </span>
    </button>
  );
}
