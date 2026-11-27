/**
 * Fiscal Earlier Attempts (#3960)
 *
 * The refused attempts that came before the receipt's current one. Asking again
 * after a refusal creates a NEW attempt record, so the refusal stays on record
 * instead of being overwritten, and the operator can still quote its codes.
 *
 * Renders nothing when there is nothing earlier.
 *
 * @module apps/web/src/features/fiscalization/components
 */
import type { ReactElement } from 'react';

import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { FiscalRegistrationRecord } from '../api/fiscalization.types';
import { FiscalFailureDetails } from './fiscal-failure-details';

interface FiscalEarlierAttemptsProps {
  /** Refused attempts, any order. Sorted oldest-first here. */
  attempts: readonly FiscalRegistrationRecord[];
}

export function FiscalEarlierAttempts({ attempts }: FiscalEarlierAttemptsProps): ReactElement | null {
  const copy = useMessages('fiscalization').attempts;
  const format = useFormat();
  if (attempts.length === 0) return null;

  const sorted = [...attempts].sort((a, b) => a.attempt - b.attempt);
  return (
    <details className="fiscal-earlier-attempts" data-testid="fiscal-earlier-attempts">
      <summary>
        {copy.title} <span className="muted-text">({attempts.length})</span>
      </summary>
      <ol className="fiscal-earlier-attempts__list">
        {sorted.map((record) => (
          <li key={record.id} className="fiscal-earlier-attempts__item">
            <div className="fiscal-earlier-attempts__head">
              <span className="fiscal-earlier-attempts__name">
                {interpolate(copy.attempt, { n: record.attempt + 1 })}
              </span>
              <StatusBadge tone="error" compact>
                {copy.refused}
              </StatusBadge>
              <span className="muted-text">{format.dateTime(record.updatedAt)}</span>
            </div>
            {record.providerFailureDetails ? (
              <FiscalFailureDetails details={{ ...record.providerFailureDetails, hint: null }} />
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
