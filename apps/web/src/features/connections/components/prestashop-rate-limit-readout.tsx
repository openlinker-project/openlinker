/**
 * PrestaShop Rate Limit Readout
 *
 * Small inline readout of a connection's live, in-memory outbound
 * rate-limit status (#1810, rebased from the PrestaShop-only #1815
 * prerequisite onto the generic shared mechanism) — configured pacing cap
 * plus current in-flight/queued counters. Plain text with tabular-nums, not
 * a meter/progress-bar primitive: this is a small secondary readout, not a
 * dashboard KPI. Refresh is a manual button only — the endpoint is a pure
 * in-memory read, and auto-polling it would be unnecessary complexity for a
 * secondary readout.
 *
 * Lives in the connections feature (not the prestashop plugin) so the plugin
 * only wires the `ExtraConfigSection` slot — mirrors how
 * `InfaktWebhookConfig` / `AllegroSellerDefaultsSection` are feature-owned
 * and plugin-consumed. Component name is kept from #1815 (mounted only in
 * PrestaShop's extra section today) even though the underlying endpoint is
 * platform-neutral — renaming/promoting it to every connection's edit form
 * is a follow-up, not part of this rebase.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import { useRateLimitStatusQuery } from '../hooks/use-rate-limit-status-query';
import { Button } from '../../../shared/ui/button';

export interface PrestashopRateLimitReadoutProps {
  connectionId: string;
}

export function PrestashopRateLimitReadout({
  connectionId,
}: PrestashopRateLimitReadoutProps): ReactElement {
  const statusQuery = useRateLimitStatusQuery(connectionId);

  if (statusQuery.isLoading) {
    return (
      <div className="prestashop-rate-limit" aria-live="polite">
        <span className="muted-text">Checking rate-limit status…</span>
      </div>
    );
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <div className="prestashop-rate-limit">
        <span className="muted-text">Couldn&apos;t load rate-limit status.</span>
        <Button tone="secondary" type="button" onClick={() => void statusQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const status = statusQuery.data;

  // Scoped to the outbound limiter on purpose (#2229): a resolve ceiling is
  // applied inside the adapter, below this mechanism, so the old blanket "this
  // connection is not rate-limited" was a claim this component was not in a
  // position to make.
  if (!status.enabled) {
    return (
      <div className="prestashop-rate-limit">
        <span className="muted-text">
          No outbound limit configured — requests to this connection are not paced.
        </span>
      </div>
    );
  }

  const capLabel =
    status.requestsPerMinute !== undefined ? `${status.requestsPerMinute}/min` : 'no per-minute cap';
  const concurrencyLabel =
    status.maxConcurrent !== undefined ? `, max ${status.maxConcurrent} concurrent` : '';

  return (
    <div className="prestashop-rate-limit" aria-live="polite">
      <div className="prestashop-rate-limit__line">
        <span className="tabular">
          Cap: {capLabel}
          {concurrencyLabel}
        </span>
      </div>
      <div className="prestashop-rate-limit__line">
        <span className="tabular muted-text">
          {status.inFlight ?? 0} in flight, {status.queued ?? 0} queued
        </span>
      </div>
      <Button
        tone="secondary"
        type="button"
        onClick={() => void statusQuery.refetch()}
        disabled={statusQuery.isFetching}
      >
        {statusQuery.isFetching ? 'Refreshing…' : 'Refresh'}
      </Button>
    </div>
  );
}
