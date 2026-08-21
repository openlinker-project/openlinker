import type { ReactElement } from 'react';
import { useCatalogTrustQuery } from '../hooks/use-catalog-trust-query';
import type { MasterCatalogRung } from '../api/connections.types';
import { formatDateTime } from '../../../shared/format/format-date';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';

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

const RUNG_LABEL: Record<MasterCatalogRung, string> = {
  'modified-since': 'Modified-since',
  'full-enumeration': 'Full enumeration',
  unknown: 'Unknown',
};

const RUNG_TONE: Record<MasterCatalogRung, StatusBadgeTone> = {
  'modified-since': 'success',
  // A declared base rung is a correct state, not a degradation — neutral.
  'full-enumeration': 'neutral',
  unknown: 'warning',
};

const RUNG_COPY: Record<MasterCatalogRung, string> = {
  'modified-since':
    'This master declares modified-since enumeration — scheduled syncs can pull only what changed.',
  'full-enumeration':
    'Full re-enumeration only — this master cannot report changes since a point in time; every catalog sync re-reads the whole catalog.',
  unknown: "Could not resolve this connection's adapter to determine its catalog sync capability.",
};

export function CatalogTrustPanel({ connectionId }: CatalogTrustPanelProps): ReactElement {
  const trustQuery = useCatalogTrustQuery(connectionId);

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Health</p>
          <h3 className="section-title">Catalog replication</h3>
        </div>
        <span className="panel__meta">Product master</span>
      </div>

      {trustQuery.isLoading ? (
        <LoadingState title="Loading catalog trust" message="Reading the master's declared sync capability." />
      ) : null}

      {trustQuery.error ? (
        <ErrorState
          title="Unable to load catalog trust"
          message={trustQuery.error.message}
          action={
            <button type="button" className="button button--secondary" onClick={() => void trustQuery.refetch()}>
              Retry
            </button>
          }
        />
      ) : null}

      {trustQuery.data ? (
        <>
          <dl className="definition-list">
            <div>
              <dt>Sync capability</dt>
              <dd>
                <StatusBadge tone={RUNG_TONE[trustQuery.data.rung]}>
                  {RUNG_LABEL[trustQuery.data.rung]}
                </StatusBadge>
              </dd>
            </div>
            {trustQuery.data.rung === 'modified-since' ? (
              <div>
                <dt>Delta pass</dt>
                <dd>{trustQuery.data.deltaPassEnabled ? 'Enabled' : 'Disabled'}</dd>
              </div>
            ) : null}
            <div>
              <dt>Deletion last reconciled</dt>
              <dd>
                {trustQuery.data.lastReconcileCompletedAt !== null
                  ? formatDateTime(trustQuery.data.lastReconcileCompletedAt)
                  : 'No cycle completed yet'}
              </dd>
            </div>
            <div>
              <dt>Reconcile cycle</dt>
              <dd>
                {trustQuery.data.reconcileCycleOpen
                  ? 'Open — resumes on the next hourly tick'
                  : 'None open'}
              </dd>
            </div>
          </dl>

          <p className="catalog-trust-panel__note">{RUNG_COPY[trustQuery.data.rung]}</p>
          {trustQuery.data.rung === 'modified-since' && !trustQuery.data.deltaPassEnabled ? (
            <p className="catalog-trust-panel__note">
              The delta pass is currently disabled (OL_MASTER_PRODUCT_DELTA_SYNC_ENABLED), so full
              re-enumeration still applies in practice.
            </p>
          ) : null}
          <p className="catalog-trust-panel__note">
            Deletion reconciliation advances one budgeted page per hourly tick — a full cycle spans
            many ticks on a large catalog, so recency here is the real deletion-detection latency.
          </p>
        </>
      ) : null}
    </div>
  );
}
