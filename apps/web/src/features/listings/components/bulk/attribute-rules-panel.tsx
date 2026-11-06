/**
 * AttributeRulesPanel (#3995)
 *
 * The bulk wizard Review step's account of what the connection's attribute
 * rules do to this batch. One quiet panel, not a stack of banners: a coverage
 * strip with one pill per parameter the rules touch - a segment per variant,
 * filled / not accepted / not filled - and, under it, only what needs the
 * operator, each with a Fix that opens the variant.
 *
 * Silent when the rules touch nothing, so a connection without rules gets no
 * new chrome. A preview that could not be loaded is stated rather than read
 * as "no rules": those variants keep their required-parameter flag.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '../../../../shared/ui';

/** One parameter the rules touch, across the variants that were checked. */
export interface ParameterCoverage {
  parameterId: string;
  name: string;
  /** One entry per checked variant, in row order. */
  segments: readonly ('filled' | 'rejected' | 'none')[];
}

export interface RejectedRuleValue {
  productId: string;
  variantId: string;
  variantLabel: string;
  parameterName: string;
  rawValue: string;
}

export interface AttributeRulesPanelProps {
  connectionId: string;
  destinationName: string;
  coverage: readonly ParameterCoverage[];
  /** Variants the preview answered for. */
  checkedVariantCount: number;
  rejected: readonly RejectedRuleValue[];
  failedVariantCount: number;
  onRetry: () => void;
  onFix: (productId: string, variantId: string) => void;
}

const REJECTED_LISTED = 4;
/** Up to this many variants the bar shows one segment each. */
const SEGMENTED_MAX = 10;

export function AttributeRulesPanel({
  connectionId,
  destinationName,
  coverage,
  checkedVariantCount,
  rejected,
  failedVariantCount,
  onRetry,
  onFix,
}: AttributeRulesPanelProps): ReactElement | null {
  if (coverage.length === 0 && failedVariantCount === 0) return null;

  const shown = rejected.slice(0, REJECTED_LISTED);
  const hidden = rejected.length - shown.length;

  return (
    <section className="rules-panel" aria-labelledby="rules-panel-title">
      <header className="rules-panel__head">
        <div className="rules-panel__heading">
          <h3 id="rules-panel-title" className="rules-panel__title">
            Attribute rules
          </h3>
          <p className="rules-panel__lede">
            {coverage.length > 0
              ? `Filled in when the offers are created${checkedVariantCount > 1 ? `, per variant` : ''}. A value you set yourself wins.`
              : 'Not checked yet.'}
          </p>
        </div>
        <Link className="rules-panel__manage" to={`/connections/${connectionId}/mappings?tab=attribute-rules`}>
          Manage rules
        </Link>
      </header>

      {coverage.length > 0 ? (
        <ul className="rules-panel__coverage" aria-label="Parameters filled by rules">
          {coverage.map((p) => (
            <CoveragePill key={p.parameterId} coverage={p} />
          ))}
        </ul>
      ) : null}

      {failedVariantCount > 0 ? (
        <div className="rules-panel__issue rules-panel__issue--failed" role="status">
          <span className="rules-panel__issue-text">
            Could not check the rules for {plural(failedVariantCount, 'variant')}. Their required
            parameters count as empty until the check succeeds.
          </span>
          <Button tone="secondary" className="button--xs" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}

      {shown.length > 0 ? (
        <ul className="rules-panel__issues" aria-label={`Values ${destinationName} does not accept`}>
          {shown.map((r) => (
            <li key={`${r.variantId}:${r.parameterName}`} className="rules-panel__issue">
              <span className="rules-panel__issue-text">
                <b>{r.parameterName}</b>: {destinationName} does not accept &ldquo;{r.rawValue}&rdquo;
              </span>
              <span className="rules-panel__issue-where">{r.variantLabel}</span>
              <Button
                tone="secondary"
                className="button--xs"
                aria-label={`Fix ${r.parameterName} for ${r.variantLabel}`}
                onClick={() => onFix(r.productId, r.variantId)}
              >
                Fix
              </Button>
            </li>
          ))}
          {hidden > 0 ? (
            <li className="rules-panel__more">and {plural(hidden, 'more value')}</li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

function CoveragePill({ coverage }: { coverage: ParameterCoverage }): ReactElement {
  const filled = coverage.segments.filter((s) => s === 'filled').length;
  const rejected = coverage.segments.filter((s) => s === 'rejected').length;
  const total = coverage.segments.length;
  const state = rejected > 0 ? 'rejected' : filled === total ? 'full' : 'partial';
  const summary =
    rejected > 0
      ? `${coverage.name}: filled for ${filled} of ${total}, ${rejected} not accepted`
      : `${coverage.name}: filled for ${filled} of ${total}`;
  return (
    <li className={`rules-pill rules-pill--${state}`} title={summary} aria-label={summary}>
      <span className="rules-pill__name">{coverage.name}</span>
      <span className="rules-pill__bar" aria-hidden="true">
        {total <= SEGMENTED_MAX
          ? coverage.segments.map((s, i) => (
              <span key={i} className={`rules-pill__seg rules-pill__seg--${s}`} />
            ))
          : (
              // Past a handful of variants one segment each turns to noise, so
              // the bar becomes proportional: filled, then not accepted.
              <>
                <span className="rules-pill__seg rules-pill__seg--filled" style={{ flexGrow: filled }} />
                <span className="rules-pill__seg rules-pill__seg--rejected" style={{ flexGrow: rejected }} />
                <span className="rules-pill__seg rules-pill__seg--none" style={{ flexGrow: total - filled - rejected }} />
              </>
            )}
      </span>
      <span className="rules-pill__count" aria-hidden="true">
        {filled}/{total}
      </span>
    </li>
  );
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
