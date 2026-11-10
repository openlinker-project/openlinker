/**
 * Bundle guide (#3520)
 *
 * The "How bundles work" reference drawer shared by the bundle form, the bundle
 * product page, the products list and the offer wizard. Content lives in the
 * `bundles.guide` locale namespace; this file only lays it out.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useMemo, type ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { GuideDrawer, type GuideSection } from '../../../shared/ui/guide-drawer';

export type BundleGuideSectionId = 'what' | 'avail' | 'gift' | 'ver' | 'offer';

export interface BundleGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The section a `?` hint pointed at; the first when null. */
  sectionId?: string | null;
}

export function BundleGuide({ open, onOpenChange, sectionId }: BundleGuideProps): ReactElement {
  const copy = useMessages('bundles');
  const sections = useMemo<GuideSection[]>(() => {
    const g = copy.guide;
    const item = (name: string, text: string): ReactElement => (
      <div className="pm-gitem" key={name}>
        <div className="pm-gitem__top">
          <span className="pm-gitem__name">{name}</span>
        </div>
        <p>{text}</p>
      </div>
    );
    const example = [
      { n: g.avail.e1n, d: g.avail.e1d, s: g.avail.e1s, hit: false },
      { n: g.avail.e2n, d: g.avail.e2d, s: g.avail.e2s, hit: true },
      { n: g.avail.e3n, d: g.avail.e3d, s: g.avail.e3s, hit: false },
    ];
    return [
      { id: 'what', number: '01', title: g.what.title, summary: g.what.summary, content: <>{item(g.what.i1n, g.what.i1t)}{item(g.what.i2n, g.what.i2t)}</> },
      {
        id: 'avail',
        number: '02',
        title: g.avail.title,
        summary: g.avail.summary,
        content: (
          <>
            {item(g.avail.i1n, g.avail.i1t)}
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
          </>
        ),
      },
      { id: 'gift', number: '03', title: g.gift.title, summary: g.gift.summary, content: item(g.gift.i1n, g.gift.i1t) },
      { id: 'ver', number: '04', title: g.ver.title, summary: g.ver.summary, content: item(g.ver.i1n, g.ver.i1t) },
      { id: 'offer', number: '05', title: g.offer.title, summary: g.offer.summary, content: item(g.offer.i1n, g.offer.i1t) },
    ];
  }, [copy]);
  return (
    <GuideDrawer
      open={open}
      onOpenChange={onOpenChange}
      eyebrow={copy.guide.eyebrow}
      title={copy.guide.title}
      lede={copy.guide.lede}
      closeLabel={copy.guide.close}
      sections={sections}
      initialSectionId={sectionId ?? null}
      footer={copy.guide.footer}
    />
  );
}
