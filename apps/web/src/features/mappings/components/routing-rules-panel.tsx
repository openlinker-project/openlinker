/**
 * RoutingRulesPanel (#836)
 *
 * Default-vs-divert editor for fulfillment routing. Lists every source
 * delivery method; each stays with the default order-management platform
 * (rule absence) unless the operator diverts it to a compatible processor.
 * The divert dropdown is filtered to the candidates the backend reports as
 * capability-compatible for this source connection. Mirrors the structure
 * and density of the sibling `MappingPanel`.
 *
 * @module apps/web/src/features/mappings/components
 */

import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { ConnectionEntityLabel, useConnectionsQuery } from '../../connections';
import { RoutingSplitBar, type RoutingSplitBucket } from './routing-split-bar';
import {
  useRoutingRulesQuery,
  useRoutingCandidatesQuery,
  useReplaceRoutingRules,
} from '../hooks/use-routing-rules';
import {
  FulfillmentProcessorKindValues,
  type FulfillmentProcessorKind,
  type MappingOption,
  type RoutingRuleInput,
} from '../api/mappings.types';

interface RoutingRulesPanelProps {
  connectionId: string;
  /** Resolved source-platform label for user-facing copy (#1784), e.g. "Allegro". */
  sourceLabel: string;
  /** Source delivery methods to route - owned by the page's `useMappingOptions`. */
  deliveryMethods: MappingOption[];
  deliveryMethodsLoading: boolean;
  deliveryMethodsError: Error | null;
}

/** Sentinel selection key meaning "no rule" → the default OMP fulfils the method. */
const DEFAULT_KEY = '__default__';

/** Human qualifier shown before the connection name in dropdowns + row display. */
const PROCESSOR_KIND_LABEL: Record<FulfillmentProcessorKind, string> = {
  omp_fulfilled: 'Order-management platform',
  ol_managed_carrier: 'OpenLinker-managed carrier',
  source_brokered: 'Marketplace-brokered',
};

/** Truncates long ids (Allegro UUIDs) for inline hints; short ids render verbatim (#474). */
function shortValue(value: string): string {
  return value.length <= 9 ? value : `${value.slice(0, 8)}…`;
}

/** `${kind}::${connectionId}` → its parts, or null for the default sentinel / malformed keys. */
function parseSelectionKey(
  key: string,
): { kind: FulfillmentProcessorKind; connectionId: string } | null {
  if (key === DEFAULT_KEY) return null;
  const idx = key.indexOf('::');
  if (idx < 0) return null;
  const kind = key.slice(0, idx) as FulfillmentProcessorKind;
  const connectionId = key.slice(idx + 2);
  if (!FulfillmentProcessorKindValues.includes(kind) || connectionId.length === 0) return null;
  return { kind, connectionId };
}

interface DivertOption {
  key: string;
  label: string;
}

export function RoutingRulesPanel({
  connectionId,
  sourceLabel,
  deliveryMethods,
  deliveryMethodsLoading,
  deliveryMethodsError,
}: RoutingRulesPanelProps): ReactElement {
  const rulesQuery = useRoutingRulesQuery(connectionId);
  const candidatesQuery = useRoutingCandidatesQuery(connectionId);
  const connectionsQuery = useConnectionsQuery();
  const replaceMutation = useReplaceRoutingRules(connectionId);

  const savedRules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);

  // Persisted selection per method (`${kind}::${connId}`); methods absent here default.
  const savedKeyByMethod = useMemo(() => {
    const map = new Map<string, string>();
    for (const rule of savedRules) {
      map.set(rule.sourceDeliveryMethodId, `${rule.processorKind}::${rule.processorConnectionId}`);
    }
    return map;
  }, [savedRules]);

  const [selections, setSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(savedKeyByMethod),
  );

  // Resync local edits to server state after a successful save / refetch.
  useEffect(() => {
    setSelections(Object.fromEntries(savedKeyByMethod));
  }, [savedKeyByMethod]);

  const connectionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const conn of connectionsQuery.data ?? []) map.set(conn.id, conn.name);
    return map;
  }, [connectionsQuery.data]);

  function connName(id: string): string {
    return connectionNameById.get(id) ?? shortValue(id);
  }

  const candidates = useMemo(() => candidatesQuery.data ?? [], [candidatesQuery.data]);

  // Default label is data-driven from the omp_fulfilled candidate (no hardcoded
  // platform name) — falls back to a generic phrase when none is reported.
  const ompCandidate = candidates.find((c) => c.processorKind === 'omp_fulfilled') ?? null;
  const defaultLabel = ompCandidate
    ? `${connName(ompCandidate.processorConnectionId)} — default`
    : 'Default (order-management platform)';

  // Divert options exclude omp_fulfilled — that IS the default in v1; explicit
  // OMP pinning is the multi-OMP follow-up.
  const divertOptions: DivertOption[] = candidates
    .filter((c) => c.processorKind !== 'omp_fulfilled')
    .map((c) => ({
      key: `${c.processorKind}::${c.processorConnectionId}`,
      label: `${PROCESSOR_KIND_LABEL[c.processorKind]} · ${connName(c.processorConnectionId)}`,
    }));

  // Render a row per delivery method, plus any saved rule whose method the
  // source no longer reports — so a replace-all save never silently drops it.
  const rowMethods = useMemo<MappingOption[]>(() => {
    const known = new Set(deliveryMethods.map((m) => m.value));
    const orphans: MappingOption[] = [];
    for (const methodId of savedKeyByMethod.keys()) {
      if (!known.has(methodId)) orphans.push({ value: methodId, label: methodId });
    }
    return [...deliveryMethods, ...orphans];
  }, [deliveryMethods, savedKeyByMethod]);

  const isDirty = rowMethods.some(
    (m) => (selections[m.value] ?? DEFAULT_KEY) !== (savedKeyByMethod.get(m.value) ?? DEFAULT_KEY),
  );

  // Routing-split buckets (#1739): methods-per-processor derived from the
  // CURRENT selections (not the saved rules), so the bar moves live while the
  // operator edits and before "Save routing". One bucket per live divert
  // candidate (kept even at 0 so its colour slot stays stable), one bucket per
  // saved-but-unavailable selection, and the default bucket last.
  const splitBuckets = useMemo<RoutingSplitBucket[]>(() => {
    const nameFor = (id: string): string => connectionNameById.get(id) ?? shortValue(id);
    const counts = new Map<string, number>();
    for (const method of rowMethods) {
      const key = selections[method.value] ?? DEFAULT_KEY;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const buckets: RoutingSplitBucket[] = candidates
      .filter((c) => c.processorKind !== 'omp_fulfilled')
      .map((c) => {
        const key = `${c.processorKind}::${c.processorConnectionId}`;
        return { key, label: nameFor(c.processorConnectionId), count: counts.get(key) ?? 0 };
      });

    for (const [key, count] of counts) {
      if (key === DEFAULT_KEY || buckets.some((b) => b.key === key)) continue;
      const parsed = parseSelectionKey(key);
      buckets.push({
        key,
        label: parsed ? `${nameFor(parsed.connectionId)} (unavailable)` : key,
        count,
      });
    }

    buckets.push({
      key: DEFAULT_KEY,
      label: defaultLabel,
      count: counts.get(DEFAULT_KEY) ?? 0,
      isDefault: true,
    });
    return buckets;
  }, [rowMethods, selections, candidates, defaultLabel, connectionNameById]);

  function optionsForRow(currentKey: string): DivertOption[] {
    const base: DivertOption[] = [{ key: DEFAULT_KEY, label: defaultLabel }, ...divertOptions];
    // Keep a saved selection visible even when it is no longer a live candidate
    // (connection disabled, capability lost), so the operator can see + decide.
    if (currentKey !== DEFAULT_KEY && !base.some((o) => o.key === currentKey)) {
      const parsed = parseSelectionKey(currentKey);
      base.push({
        key: currentKey,
        label: parsed
          ? `${PROCESSOR_KIND_LABEL[parsed.kind]} · ${connName(parsed.connectionId)} (unavailable)`
          : currentKey,
      });
    }
    return base;
  }

  function handleSelect(methodId: string, key: string): void {
    setSelections((prev) => ({ ...prev, [methodId]: key }));
  }

  function handleSave(): void {
    const items: RoutingRuleInput[] = [];
    for (const method of rowMethods) {
      const key = selections[method.value] ?? DEFAULT_KEY;
      const parsed = parseSelectionKey(key);
      if (!parsed) continue;
      items.push({
        sourceDeliveryMethodId: method.value,
        processorKind: parsed.kind,
        processorConnectionId: parsed.connectionId,
      });
    }
    replaceMutation.mutate({ items });
  }

  if (deliveryMethodsLoading || rulesQuery.isLoading || candidatesQuery.isLoading) {
    return (
      <LoadingState
        liveRegion="off"
        title="Loading fulfillment routing"
        message="Fetching delivery methods and compatible processors…"
      />
    );
  }

  const dataError = deliveryMethodsError ?? rulesQuery.error ?? candidatesQuery.error ?? null;
  if (dataError) {
    return <ErrorState title="Unable to load routing configuration" message={dataError.message} />;
  }

  function renderMethodLabel(method: MappingOption): ReactNode {
    if (method.label === method.value) {
      return <span className="mono-text">{method.value}</span>;
    }
    return (
      <>
        {method.label}{' '}
        <span className="mapping-id-hint mono-text">{shortValue(method.value)}</span>
      </>
    );
  }

  function renderRoutedTo(currentKey: string): ReactNode {
    if (currentKey === DEFAULT_KEY) {
      return <span className="muted-text">{defaultLabel}</span>;
    }
    const parsed = parseSelectionKey(currentKey);
    if (!parsed) return <span className="mono-text">{currentKey}</span>;
    return (
      <>
        <span>{PROCESSOR_KIND_LABEL[parsed.kind]}</span>{' '}
        <ConnectionEntityLabel
          connectionId={parsed.connectionId}
          linkToDetail={false}
          showId={false}
        />
      </>
    );
  }

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h3 className="section-title">Fulfillment Routing</h3>
        </div>
        {isDirty && (
          <span className="status-badge status-badge--warning" aria-live="polite">
            Unsaved changes
          </span>
        )}
      </div>

      <p className="muted-text" style={{ marginBottom: 'var(--space-4)' }}>
        Choose how each {sourceLabel} delivery method is fulfilled. Methods stay with the default
        order-management platform unless you divert them to a connected carrier or
        marketplace-delivery processor.
      </p>

      {divertOptions.length === 0 && (
        <p
          className="muted-text"
          role="status"
          aria-live="polite"
          style={{ marginBottom: 'var(--space-3)' }}
        >
          No compatible fulfillment processors are connected yet. Every method stays with the
          default until you add a carrier-managed or marketplace-delivery connection.
        </p>
      )}

      {rowMethods.length > 0 && <RoutingSplitBar buckets={splitBuckets} />}

      {rowMethods.length === 0 ? (
        <p className="muted-text" role="status" aria-live="polite">
          This connection reported no delivery methods to route. Routing becomes configurable once
          the source exposes delivery methods.
        </p>
      ) : (
        <table className="data-table data-table--stackable" aria-label="Fulfillment routing rules">
          <thead>
            <tr>
              <th>{sourceLabel} delivery method</th>
              <th>Routed to</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {rowMethods.map((method) => {
              const currentKey = selections[method.value] ?? DEFAULT_KEY;
              return (
                <tr key={method.value}>
                  <td data-label={`${sourceLabel} delivery method`}>{renderMethodLabel(method)}</td>
                  <td data-label="Routed to">{renderRoutedTo(currentKey)}</td>
                  <td data-label="Change">
                    <select
                      aria-label={`Fulfillment processor for ${method.label}`}
                      value={currentKey}
                      onChange={(e) => { handleSelect(method.value, e.target.value); }}
                    >
                      {optionsForRow(currentKey).map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {replaceMutation.error && (
        <p className="error-message" role="alert" style={{ marginTop: 'var(--space-2)' }}>
          {replaceMutation.error.message}
        </p>
      )}

      <div
        style={{
          marginTop: 'var(--space-4)',
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'center',
        }}
      >
        <Button tone="primary" disabled={!isDirty || replaceMutation.isPending} onClick={handleSave}>
          {replaceMutation.isPending ? 'Saving…' : 'Save routing'}
        </Button>
        {replaceMutation.error && (
          <Button tone="secondary" disabled={replaceMutation.isPending} onClick={handleSave}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
