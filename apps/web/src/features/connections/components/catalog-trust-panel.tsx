import type { ReactElement } from 'react';
import { useFormat, useMessages } from '../../../shared/i18n';
import { useCatalogTrustQuery } from '../hooks/use-catalog-trust-query';
import type { MasterCatalogRung } from '../api/connections.types';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { describeApiError } from '../../../shared/api/describe-api-error';

/**
 * Catalog trust panel (#2258) — the operator-facing half of ADR-048
 * decision 2, rendered on the connection detail page's health tab for
 * ProductMaster connections (the caller owns the capability gate).
 *
 * All copy is in CAPABILITY terms, never platform names, and every claim is
 * limited to what the read supports: `unknown` states the adapter did not
 * answer (never asserts a rung), and an open reconcile cycle is "open —
 * resumes on the next hourly tick", never "running".
 */

interface CatalogTrustPanelProps {
  connectionId: string;
}


const RUNG_TONE: Record<MasterCatalogRung, StatusBadgeTone> = {
  'modified-since': 'success',
  // A declared base rung is a correct state, not a degradation — neutral.
  'full-enumeration': 'neutral',
  unknown: 'warning',
};


export function CatalogTrustPanel({ connectionId }: CatalogTrustPanelProps): ReactElement {
  const copy = useMessages('connections').catalogTrustPanel;
  const format = useFormat();
  const trustQuery = useCatalogTrustQuery(connectionId);

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <span className="panel__meta">{copy.meta}</span>
      </div>

      {trustQuery.isLoading ? (
        <LoadingState title={copy.loadingTitle} message={copy.loadingMessage} />
      ) : null}

      {trustQuery.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={describeApiError(trustQuery.error, 'connections')}
          action={
            <button type="button" className="button button--secondary" onClick={() => void trustQuery.refetch()}>
              {copy.retry}
            </button>
          }
        />
      ) : null}

      {trustQuery.data ? (
        <>
          <dl className="definition-list">
            <div>
              <dt>{copy.syncCapability}</dt>
              <dd>
                <StatusBadge tone={RUNG_TONE[trustQuery.data.rung]}>
                  {copy.rungLabels[trustQuery.data.rung]}
                </StatusBadge>
              </dd>
            </div>
            {trustQuery.data.rung === 'modified-since' ? (
              <div>
                <dt>{copy.deltaPass}</dt>
                <dd>{trustQuery.data.deltaPassEnabled ? copy.enabled : copy.disabled}</dd>
              </div>
            ) : null}
            <div>
              <dt>{copy.lastReconciled}</dt>
              <dd>
                {trustQuery.data.lastReconcileCompletedAt !== null
                  ? format.dateTime(trustQuery.data.lastReconcileCompletedAt)
                  : copy.noCycle}
              </dd>
            </div>
            <div>
              <dt>{copy.reconcileCycle}</dt>
              <dd>
                {trustQuery.data.reconcileCycleOpen
                  ? copy.cycleOpen
                  : copy.cycleNone}
              </dd>
            </div>
          </dl>

          <p className="catalog-trust-panel__note">{copy.rungNotes[trustQuery.data.rung]}</p>
          {trustQuery.data.rung === 'modified-since' && !trustQuery.data.deltaPassEnabled ? (
            <p className="catalog-trust-panel__note">
              {copy.deltaDisabledNote}
            </p>
          ) : null}
          <p className="catalog-trust-panel__note">
            {copy.reconcileNote}
          </p>
        </>
      ) : null}
    </div>
  );
}
