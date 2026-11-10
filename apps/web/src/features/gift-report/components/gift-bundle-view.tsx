/**
 * Bundle view of the gift report
 *
 * Bundle sales (units, net revenue, component cost, the part given free, margin)
 * with each row openable to show what its components drew, and the demand
 * bundles put on those components. When any component has no purchase cost the
 * margin is withheld and the row says so, instead of a margin built on a missing
 * number.
 *
 * @module features/gift-report/components
 */
import { Fragment, useState, type ReactElement } from 'react';
import { interpolate, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { VariantThumbnail } from '../../products';
import { useGiftBundleReportQuery } from '../hooks/use-gift-report-query';
import type { GiftReportFilters } from '../api/gift-report.types';

export function GiftBundleView({ filters }: { filters: GiftReportFilters }): ReactElement {
  const copy = useMessages('gift-report').bundles;
  const errorCopy = useMessages('gift-report').error;
  const format = useFormat();
  const plural = usePlural();
  const query = useGiftBundleReportQuery(filters);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  if (query.isPending) return <LoadingState title={copy.salesTitle} message={copy.salesTitle} />;
  if (query.isError) return <ErrorState title={errorCopy} message={errorCopy} />;
  const { bundles, demand } = query.data;
  if (bundles.length === 0) {
    return (
      <p className="muted-text" data-testid="gift-report-bundle-empty">
        {copy.empty}
      </p>
    );
  }
  const money = (amount: number, currency: string | null): string =>
    format.money(amount, currency ?? undefined);
  const toggle = (key: string): void =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="gift-bundles">
      <div className="gift-tbl">
        <div className="gift-tbl__cap">
          <h2>{copy.salesTitle}</h2>
          <span className="gift-tbl__note" data-testid="gift-report-bundle-note">
            {copy.note}
          </span>
        </div>
        <div className="data-table__container">
          <table className="data-table" data-testid="gift-report-bundle-table">
            <caption className="sr-only">{copy.salesTitle}</caption>
            <thead>
              <tr>
                <th style={{ width: '2.5rem' }} />
                <th>{copy.bundle}</th>
                <th className="n">{copy.sold}</th>
                <th className="n">{copy.revenue}</th>
                <th className="n">{copy.componentCost}</th>
                <th className="n">{copy.giftPart}</th>
                <th className="n">{copy.margin}</th>
              </tr>
            </thead>
            <tbody>
              {bundles.map((row) => {
                const key = `${row.bundleVariantId}|${row.currency ?? ''}`;
                const expanded = open.has(key);
                const name = row.name ?? row.sku ?? row.bundleVariantId;
                return (
                  <Fragment key={key}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className="gift-exp"
                          aria-expanded={expanded}
                          aria-label={interpolate(copy.showComponents, { name })}
                          onClick={() => toggle(key)}
                        >
                          ›
                        </button>
                      </td>
                      <td>
                        <span className="gift-gift">
                          <VariantThumbnail
                            src={`/products/variants/${row.bundleVariantId}/images/0`}
                            name={name}
                            size="sm"
                          />
                          <span>
                            <b>{name}</b>
                            <small>
                              {row.sku !== null ? `${row.sku} · ` : ''}
                              {plural(row.components.length, copy.componentCount)}
                            </small>
                          </span>
                        </span>
                      </td>
                      <td className="n mono-text">{interpolate(copy.pieces, { n: row.unitsSold })}</td>
                      <td className="n mono-text">
                        {row.revenueNet === null ? copy.unknown : money(row.revenueNet, row.currency)}
                      </td>
                      <td
                        className="n mono-text"
                        data-testid={row.componentCostMissing ? `gift-report-bundle-nocost-${row.bundleVariantId}` : undefined}
                      >
                        {row.costNet === null ? copy.unknown : money(row.costNet, row.currency)}
                        {row.componentCostMissing ? (
                          <span className="gift-unk">{copy.componentCostMissing}</span>
                        ) : null}
                      </td>
                      <td className="n mono-text">
                        {row.hasGiftSlot ? money(row.giftCostNet, row.currency) : '-'}
                      </td>
                      <td className="n mono-text">
                        {row.marginNet === null || row.revenueNet === null || row.revenueNet === 0 ? (
                          <span className="gift-hint">{copy.marginUnknown}</span>
                        ) : (
                          format.percent(row.marginNet / row.revenueNet)
                        )}
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="gift-comp">
                        <td />
                        <td colSpan={6}>
                          <table className="data-table gift-comp__table">
                            <tbody>
                              {row.components.map((component) => (
                                <tr key={component.variantId}>
                                  <td>
                                    <span className="gift-gift">
                                      <VariantThumbnail
                                        src={`/products/variants/${component.variantId}/images/0`}
                                        name={component.name ?? component.sku ?? component.variantId}
                                        size="sm"
                                      />
                                      <span>
                                        <b>{component.name ?? component.sku ?? component.variantId}</b>
                                        <small>
                                          {component.sku}
                                          {component.giftSlot ? (
                                            <>
                                              {' · '}
                                              <span className="chip chip--success gift-comp__chip">
                                                {copy.giftInComposition}
                                              </span>
                                            </>
                                          ) : null}
                                        </small>
                                      </span>
                                    </span>
                                  </td>
                                  <td>{interpolate(copy.pieces, { n: component.units })}</td>
                                  <td className="n mono-text">
                                    {component.unitCostNet === null ? (
                                      <span className="gift-unk gift-unk--inline">{copy.costUnknown}</span>
                                    ) : (
                                      interpolate(copy.perPiece, {
                                        price: money(component.unitCostNet, row.currency),
                                      })
                                    )}
                                  </td>
                                  <td className="n mono-text">
                                    {component.costNet === null ? copy.unknown : money(component.costNet, row.currency)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="gift-tbl">
        <div className="gift-tbl__cap">
          <h2>{copy.demandTitle}</h2>
          <span className="gift-tbl__note">{copy.demandNote}</span>
        </div>
        <div className="data-table__container">
          <table className="data-table" data-testid="gift-report-demand-table">
            <caption className="sr-only">{copy.demandTitle}</caption>
            <thead>
              <tr>
                <th>{copy.component}</th>
                <th className="n">{copy.inBundles}</th>
                <th className="n">{copy.alone}</th>
                <th className="n">{copy.available}</th>
              </tr>
            </thead>
            <tbody>
              {demand.map((row) => (
                <tr key={row.variantId}>
                  <td>
                    <b>{row.name ?? row.sku ?? row.variantId}</b>
                  </td>
                  <td className="n mono-text">{format.number(row.inBundles)}</td>
                  <td className="n mono-text">{format.number(row.alone)}</td>
                  <td className="n mono-text">
                    {row.available === null ? copy.unknown : format.number(row.available)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
