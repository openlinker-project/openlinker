/**
 * AttributeRulesNotice (#3995)
 *
 * One batch-level notice on the bulk wizard's Review step saying what the
 * connection's attribute rules do to this batch: how many parameters they fill
 * (and that those values are what the marketplace receives), which rule values
 * the marketplace will not accept, and - when the preview could not be loaded -
 * that nothing was checked. Silent when rules touch nothing, so a connection
 * without rules sees no new chrome.
 *
 * A failed preview is said out loud rather than read as "no rules": the
 * variants it covers keep their required-parameter flag, and the operator should
 * know why.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Alert, Button } from '../../../../shared/ui';
import type { ProjectedParameterOrigin } from '../../api/listings.types';

export interface RejectedRuleValue {
  variantLabel: string;
  origin: ProjectedParameterOrigin;
}

export interface AttributeRulesNoticeProps {
  connectionId: string;
  destinationName: string;
  /** Rule-filled parameter count across included variants. */
  filledCount: number;
  /** Included variants that have at least one rule-filled parameter. */
  filledVariantCount: number;
  rejected: readonly RejectedRuleValue[];
  failedVariantCount: number;
  onRetry: () => void;
}

const REJECTED_LISTED = 3;

export function AttributeRulesNotice({
  connectionId,
  destinationName,
  filledCount,
  filledVariantCount,
  rejected,
  failedVariantCount,
  onRetry,
}: AttributeRulesNoticeProps): ReactElement | null {
  const rulesLink = (
    <Link to={`/connections/${connectionId}/mappings?tab=attribute-rules`}>Attribute rules</Link>
  );

  if (failedVariantCount > 0) {
    return (
      <Alert
        tone="warning"
        title={`Attribute rules could not be checked for ${plural(failedVariantCount, 'variant')}`}
        action={
          <Button tone="secondary" className="button--sm" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        Until they are checked, their required parameters count as empty. Nothing has been sent.
      </Alert>
    );
  }

  const shown = rejected.slice(0, REJECTED_LISTED);
  const more = rejected.length - shown.length;
  const rejectedAlert =
    rejected.length > 0 ? (
      <Alert
        tone="warning"
        title={`${plural(rejected.length, 'rule value')} not accepted by ${destinationName}`}
      >
        <ul className="attribute-rules-notice__list">
          {shown.map(({ variantLabel, origin }) => (
            <li key={`${variantLabel}:${origin.parameterId}`}>
              <b>{origin.parameterName}</b>: &quot;{origin.rawValue}&quot; for {variantLabel}
            </li>
          ))}
          {more > 0 ? <li>and {more} more</li> : null}
        </ul>
        These values are not on {destinationName}&apos;s list, so they would be dropped. Pick a value
        on the variant, or add a translation in {rulesLink}.
      </Alert>
    ) : null;

  const filledAlert =
    filledCount > 0 ? (
      <Alert
        tone="info"
        density="compact"
        title={`Your attribute rules fill ${plural(filledCount, 'parameter')} on ${plural(filledVariantCount, 'variant')}`}
      >
        These values are sent to {destinationName}. A value you set on a variant replaces the
        rule&apos;s. Manage them in {rulesLink}.
      </Alert>
    ) : null;

  if (!rejectedAlert && !filledAlert) return null;
  return (
    <div className="attribute-rules-notice">
      {rejectedAlert}
      {filledAlert}
    </div>
  );
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
