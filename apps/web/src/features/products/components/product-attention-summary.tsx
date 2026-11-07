/**
 * ProductAttentionSummary (#4027)
 *
 * "Needs a look" for the products list: three totals (listing gaps, no tax
 * rate, no cost price), each opening a popover. It replaces the Listing gaps
 * and No tax rate tiles, the cost coverage banner and the never-checked alert;
 * every one of them is an item or a link inside a group, and each item writes
 * the same URL filter its old tile or chip wrote.
 *
 * Counts are `undefined` while their probe loads or after it fails, and render
 * as a dash, never a 0.
 *
 * @module apps/web/src/features/products/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import { AttentionSummary, type AttentionGroup } from '../../../shared/ui/attention-summary';

export interface ProductGapConnection {
  id: string;
  name: string;
  /** The platform's display name, e.g. "Allegro". */
  platform: string;
  count: number | undefined;
}

export interface ProductCostGap {
  /** Variants sold in the window with no cost price. */
  count: number;
  days: number;
  netSales: number;
  currency: string;
}

export interface ProductAttentionSummaryProps {
  /** `unlistedOn` value meaning "on any marketplace" (every offer connection). */
  allGapsValue: string;
  gapsCount: number | undefined;
  gapConnections: readonly ProductGapConnection[];
  unlistedOn: string;
  onUnlistedOnChange: (next: string) => void;
  /** `false` when no shop can be asked for a rate: the tax group is left out. */
  showTax: boolean;
  taxMissingCount: number | undefined;
  taxNotCheckedCount: number | undefined;
  taxRateState: 'missing' | 'not-checked' | 'known' | undefined;
  onTaxRateStateChange: (next: 'missing' | 'not-checked' | null) => void;
  /** `null` hides the cost group (margin tracking off, or nothing to say). */
  costGap: ProductCostGap | null | undefined;
}

function sum(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

export function ProductAttentionSummary({
  allGapsValue,
  gapsCount,
  gapConnections,
  unlistedOn,
  onUnlistedOnChange,
  showTax,
  taxMissingCount,
  taxNotCheckedCount,
  taxRateState,
  onTaxRateStateChange,
  costGap,
}: ProductAttentionSummaryProps): ReactElement {
  const copy = useMessages('products').productsListPage.listFilters;
  const costCopy = useMessages('products').costCoverageBanner;
  const plural = usePlural();
  const format = useFormat();
  const attn = copy.attention;

  const groups: AttentionGroup[] = [];
  if (gapConnections.length > 0) {
    groups.push({
      id: 'gaps',
      label: attn.gaps.label,
      short: attn.gaps.short,
      tone: 'warning',
      total: gapsCount,
      items: [
        {
          id: 'any',
          label: attn.gaps.any.title,
          desc: attn.gaps.any.desc,
          tone: 'warning',
          on: unlistedOn !== '' && unlistedOn === allGapsValue,
          count: gapsCount,
          toggle: () => {
            onUnlistedOnChange(unlistedOn === allGapsValue ? '' : allGapsValue);
          },
        },
        ...gapConnections.map((c) => ({
          id: c.id,
          label: interpolate(attn.gaps.on.title, { name: c.name }),
          desc: interpolate(attn.gaps.on.desc, { platform: c.platform }),
          tone: 'warning' as const,
          on: unlistedOn === c.id,
          count: c.count,
          toggle: () => {
            onUnlistedOnChange(unlistedOn === c.id ? '' : c.id);
          },
        })),
      ],
    });
  }
  if (showTax) {
    groups.push({
      id: 'tax',
      label: attn.tax.label,
      short: attn.tax.short,
      tone: 'error',
      total: sum(taxMissingCount, taxNotCheckedCount),
      items: [
        {
          id: 'missing',
          label: attn.tax.missing.title,
          desc: attn.tax.missing.desc,
          tone: 'error',
          on: taxRateState === 'missing',
          count: taxMissingCount,
          toggle: () => {
            onTaxRateStateChange(taxRateState === 'missing' ? null : 'missing');
          },
        },
        {
          id: 'not-checked',
          label: attn.tax.notChecked.title,
          desc: attn.tax.notChecked.desc,
          tone: 'warning',
          on: taxRateState === 'not-checked',
          count: taxNotCheckedCount,
          toggle: () => {
            onTaxRateStateChange(taxRateState === 'not-checked' ? null : 'not-checked');
          },
        },
      ],
    });
  }
  if (costGap !== null) {
    groups.push({
      id: 'cost',
      label: attn.cost.label,
      short: attn.cost.short,
      tone: null,
      total: costGap?.count,
      body: (close) =>
        costGap ? (
          <div className="attention-note">
            <p>
              {plural(costGap.count, costCopy.title, { days: costGap.days })}.{' '}
              {interpolate(costCopy.bodyNetSales, {
                amount: format.money(costGap.netSales, costGap.currency),
              })}
            </p>
            <Link
              className="button button--secondary button--sm"
              to="/products/cost-prices?tab=all"
              data-testid="products-attention-cost-link"
              onClick={close}
            >
              {attn.cost.setCostPrices}
            </Link>
          </div>
        ) : null,
    });
  }

  return <AttentionSummary label={copy.needsLook} groups={groups} />;
}
