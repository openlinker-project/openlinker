/**
 * Bundle guide (#3520)
 *
 * The "How bundles work" reference drawer shared by the bundle form, the bundle
 * product page, the products list and the offer wizard. Content lives in the
 * `bundles.guide` locale namespace; this file only lays it out.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useMemo, type ReactElement, type ReactNode } from 'react';
import { useMessages } from '../../../shared/i18n';
import { PageGuide, type GuideSection } from '../../../shared/ui/guide-drawer';

/** Wraps a page with the bundle guide drawer, the `?` shortcut and `useGuide`. */
export function BundleGuide({ children }: { children: ReactNode }): ReactElement {
  const copy = useMessages('bundles');
  const g = copy.guide;
  const sections = useMemo<GuideSection[]>(() => {
    const entry = (id: string, name: string, body: string): GuideSection['items'][number] => ({ id, name, body });
    const example = [
      { n: g.avail.e1n, d: g.avail.e1d, s: g.avail.e1s, hit: false },
      { n: g.avail.e2n, d: g.avail.e2d, s: g.avail.e2s, hit: true },
      { n: g.avail.e3n, d: g.avail.e3d, s: g.avail.e3s, hit: false },
    ];
    return [
      {
        id: 'what',
        number: '01',
        title: g.what.title,
        summary: g.what.summary,
        items: [entry('g-what', g.what.i1n, g.what.i1t), entry('g-what2', g.what.i2n, g.what.i2t)],
      },
      {
        id: 'avail',
        number: '02',
        title: g.avail.title,
        summary: g.avail.summary,
        items: [entry('g-avail', g.avail.i1n, g.avail.i1t)],
        extra: (
          <ol className="pm-flow" aria-label={g.exampleLabel}>
            {example.map((step, index) => (
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
      { id: 'gift', number: '03', title: g.gift.title, summary: g.gift.summary, items: [entry('g-gift', g.gift.i1n, g.gift.i1t)] },
      { id: 'ver', number: '04', title: g.ver.title, summary: g.ver.summary, items: [entry('g-ver', g.ver.i1n, g.ver.i1t)] },
      { id: 'offer', number: '05', title: g.offer.title, summary: g.offer.summary, items: [entry('g-offer', g.offer.i1n, g.offer.i1t)] },
    ];
  }, [g]);
  return (
    <PageGuide title={g.title} lede={g.lede} sections={sections} defaultOpen={['what']}>
      {children}
    </PageGuide>
  );
}
