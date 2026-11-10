/**
 * Promotions guide (#3935, mockup guide drawer)
 *
 * The content of "How promotions work": six short sections, each with named
 * entries the `?` hints on the pages open directly (`g-order`, `g-nostack`,
 * `g-skip`, `g-limit`, `g-perclient`, `g-doc`). Wrapped around a page with
 * `PromotionsGuide`, which owns the drawer and the `?` shortcut.
 *
 * @module apps/web/src/features/promotions/components
 */
import { useMemo, type ReactElement, type ReactNode } from 'react';
import { useMessages } from '../../../shared/i18n';
import { GuideProvider, type GuideContent } from '../../../shared/ui/guide-drawer';

export function PromotionsGuide({ children }: { children: ReactNode }): ReactElement {
  const g = useMessages('promotions').guide;
  const content = useMemo<GuideContent>(
    () => ({
      eyebrow: g.eyebrow,
      title: g.title,
      lede: g.lede,
      closeLabel: g.close,
      footer: (
        <>
          {g.footerBefore} <span className="pm-kbd">?</span> {g.footerMid} <span className="pm-kbd">{g.escKey}</span> {g.footerEnd}
        </>
      ),
      defaultOpen: ['s-order'],
      sections: [
        {
          id: 's-what',
          number: '01',
          title: g.s.what.title,
          summary: g.s.what.sum,
          items: [
            { id: 'g-what', name: g.i.what.name, body: g.i.what.body },
            { id: 'g-channels', name: g.i.channels.name, body: g.i.channels.body },
          ],
        },
        {
          id: 's-order',
          number: '02',
          title: g.s.order.title,
          summary: g.s.order.sum,
          items: [{ id: 'g-order', name: g.i.order.name, body: g.i.order.body }],
          extra: (
            <ol className="pm-flow" aria-label={g.flow.aria}>
              <li className="is-hit">
                <span className="pm-flow__n">1</span>
                <span>
                  {g.flow.s1}
                  <small>{g.flow.s1d}</small>
                </span>
                <span className="chip">{g.flow.s1c}</span>
              </li>
              <li className="is-skip">
                <span className="pm-flow__n">2</span>
                <span>
                  {g.flow.s2}
                  <small>{g.flow.s2d}</small>
                </span>
              </li>
              <li className="is-skip">
                <span className="pm-flow__n">3</span>
                <span>
                  {g.flow.s3}
                  <small>{g.flow.s3d}</small>
                </span>
              </li>
            </ol>
          ),
        },
        {
          id: 's-stack',
          number: '03',
          title: g.s.stack.title,
          summary: g.s.stack.sum,
          items: [
            {
              id: 'g-nostack',
              name: g.i.nostack.name,
              chip: <span className="chip">{g.i.nostack.chip}</span>,
              body: g.i.nostack.body,
            },
            { id: 'g-skip', name: g.i.skip.name, body: g.i.skip.body },
          ],
        },
        {
          id: 's-limits',
          number: '04',
          title: g.s.limits.title,
          summary: g.s.limits.sum,
          items: [
            { id: 'g-limit', name: g.i.limit.name, body: g.i.limit.body },
            { id: 'g-stock', name: g.i.stock.name, body: g.i.stock.body },
            { id: 'g-perclient', name: g.i.perclient.name, body: g.i.perclient.body },
          ],
        },
        {
          id: 's-doc',
          number: '05',
          title: g.s.doc.title,
          summary: g.s.doc.sum,
          items: [
            { id: 'g-doc', name: g.i.doc.name, body: g.i.doc.body },
            { id: 'g-ownprice', name: g.i.ownprice.name, body: g.i.ownprice.body },
          ],
        },
        {
          id: 's-new',
          number: '06',
          title: g.s.new.title,
          summary: g.s.new.sum,
          items: [{ id: 'g-new', name: g.i.new.name, body: g.i.new.body }],
        },
      ],
    }),
    [g],
  );
  return <GuideProvider content={content}>{children}</GuideProvider>;
}
