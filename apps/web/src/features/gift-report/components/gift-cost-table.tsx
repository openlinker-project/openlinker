/**
 * Gift cost table
 *
 * What gifts cost, by promotion or by gift product, with the channels that sent
 * them and a total row per currency. The cost column states only what is known:
 * a gift with no purchase cost on file shows "Cost unknown" (or "without N
 * pcs") and its units are NOT in the amount, so a missing cost never reads as a
 * free gift. A promotion that was deleted stays in the report under its own name.
 *
 * @module features/gift-report/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { VariantThumbnail } from '../../products';
import type { GiftReportGroup } from '../api/gift-report.types';
import { groupByGiftProduct } from '../lib/gift-report-view';
import { GiftChannelChips } from './gift-channel-chips';

export type GiftGrouping = 'promotion' | 'product';

interface GiftCostTableProps {
  groups: readonly GiftReportGroup[];
  by: GiftGrouping;
  onByChange: (by: GiftGrouping) => void;
}

interface Totals {
  currency: string | null;
  orders: number;
  units: number;
  costNet: number;
}

function totalsOf(
  rows: ReadonlyArray<{ currency: string | null; orders: number; units: number; costNet: number }>,
): Totals[] {
  const byCurrency = new Map<string, Totals>();
  for (const row of rows) {
    const total = byCurrency.get(row.currency ?? '') ?? {
      currency: row.currency,
      orders: 0,
      units: 0,
      costNet: 0,
    };
    total.orders += row.orders;
    total.units += row.units;
    total.costNet += row.costNet;
    byCurrency.set(row.currency ?? '', total);
  }
  return [...byCurrency.values()];
}

function CostCell({
  cost,
  units,
  unknown,
  currency,
  testId,
}: {
  cost: number;
  units: number;
  unknown: number;
  currency: string | null;
  testId: string;
}): ReactElement {
  const copy = useMessages('gift-report').table;
  const format = useFormat();
  const known = units - unknown;
  return (
    <span data-testid={testId}>
      {known > 0 ? format.money(cost, currency ?? undefined) : null}
      {unknown > 0 ? (
        <span className="gift-unk" data-testid={`${testId}-unknown`}>
          {known > 0 ? interpolate(copy.withoutPieces, { n: unknown }) : copy.costUnknown}
        </span>
      ) : null}
    </span>
  );
}

function GiftCell({
  productId,
  variantId,
  name,
  sku,
}: {
  productId: string;
  variantId: string | null;
  name: string | null;
  sku: string | null;
}): ReactElement {
  const label = name ?? sku ?? productId;
  return (
    <span className="gift-gift">
      <VariantThumbnail
        src={variantId === null ? `/products/${productId}/images/0` : `/products/variants/${variantId}/images/0`}
        name={label}
        size="sm"
      />
      <span>
        <b>{label}</b>
        {sku !== null && name !== null ? <small>{sku}</small> : null}
      </span>
    </span>
  );
}

export function GiftCostTable({ groups, by, onByChange }: GiftCostTableProps): ReactElement {
  const copy = useMessages('gift-report').table;
  const format = useFormat();
  const money = (amount: number, currency: string | null): string =>
    format.money(amount, currency ?? undefined);

  function promotionName(group: GiftReportGroup): ReactElement {
    if (group.giftSource === 'operator') return <span className="gift-name">{copy.manualLabel}</span>;
    if (group.giftSource === 'bundle') return <span className="gift-name">{copy.bundleLabel}</span>;
    if (group.ruleRef !== null) {
      return group.ruleName === null ? (
        <span className="gift-del">{copy.deletedRule}</span>
      ) : (
        <Link className="link gift-name" to={`/automations/gifts/${group.ruleRef}`}>
          {group.ruleName}
        </Link>
      );
    }
    return <span className="gift-name">{copy.channelLabel}</span>;
  }

  const products = by === 'product' ? groupByGiftProduct(groups) : [];
  const totals = totalsOf(by === 'product' ? products : groups);

  return (
    <section className="gift-tbl" aria-label={copy.title}>
      <div className="gift-tbl__cap">
        <h2>{by === 'product' ? copy.titleByProduct : copy.title}</h2>
        <SegmentedControl<GiftGrouping>
          aria-label={copy.groupingAria}
          value={by}
          onChange={onByChange}
          options={[
            { value: 'promotion', label: copy.byPromotion, 'data-testid': 'gift-report-by-promotion' },
            { value: 'product', label: copy.byProduct, 'data-testid': 'gift-report-by-product' },
          ]}
        />
      </div>
      <div className="data-table__container">
        {by === 'promotion' ? (
          <table className="data-table" data-testid="gift-report-table">
            <caption className="sr-only">{copy.title}</caption>
            <thead>
              <tr>
                <th>{copy.promotion}</th>
                <th>{copy.gift}</th>
                <th>{copy.channels}</th>
                <th className="n">{copy.orders}</th>
                <th className="n">{copy.pieces}</th>
                <th className="n">{copy.cost}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.key} data-testid={`gift-report-row-${group.key}`}>
                  <td data-testid={`gift-report-row-promotion-${group.key}`}>{promotionName(group)}</td>
                  <td>
                    <GiftCell
                      productId={group.productId}
                      variantId={group.variantId}
                      name={group.name}
                      sku={group.sku}
                    />
                  </td>
                  <td>
                    <GiftChannelChips ids={group.sourceConnectionIds} />
                  </td>
                  <td className="n mono-text">{format.number(group.orders)}</td>
                  <td className="n mono-text" data-testid={`gift-report-units-${group.key}`}>
                    {format.number(group.units)}
                  </td>
                  <td className="n mono-text">
                    <CostCell
                      cost={group.costNet}
                      units={group.units}
                      unknown={group.unknownCostUnits}
                      currency={group.currency}
                      testId={`gift-report-cost-${group.key}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {totals.map((total) => (
                <tr key={total.currency ?? 'none'}>
                  <td colSpan={3}>{copy.total}</td>
                  <td className="n mono-text">{format.number(total.orders)}</td>
                  <td className="n mono-text">{format.number(total.units)}</td>
                  <td className="n mono-text">{money(total.costNet, total.currency)}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        ) : (
          <table className="data-table" data-testid="gift-report-product-table">
            <caption className="sr-only">{copy.titleByProduct}</caption>
            <thead>
              <tr>
                <th>{copy.gift}</th>
                <th>{copy.channels}</th>
                <th className="n">{copy.orders}</th>
                <th className="n">{copy.pieces}</th>
                <th className="n">{copy.cost}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((row) => (
                <tr key={row.key}>
                  <td>
                    <GiftCell
                      productId={row.productId}
                      variantId={row.variantId}
                      name={row.name}
                      sku={row.sku}
                    />
                  </td>
                  <td>
                    <GiftChannelChips ids={row.sourceConnectionIds} />
                  </td>
                  <td className="n mono-text">{format.number(row.orders)}</td>
                  <td className="n mono-text">{format.number(row.units)}</td>
                  <td className="n mono-text">
                    <CostCell
                      cost={row.costNet}
                      units={row.units}
                      unknown={row.unknownCostUnits}
                      currency={row.currency}
                      testId={`gift-report-product-cost-${row.key}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {totals.map((total) => (
                <tr key={total.currency ?? 'none'}>
                  <td colSpan={2}>{copy.total}</td>
                  <td className="n mono-text">{format.number(total.orders)}</td>
                  <td className="n mono-text">{format.number(total.units)}</td>
                  <td className="n mono-text">{money(total.costNet, total.currency)}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        )}
      </div>
    </section>
  );
}
