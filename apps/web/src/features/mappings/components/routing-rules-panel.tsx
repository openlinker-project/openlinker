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

import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '../../../shared/ui/button';
import { DataTable, type DataTableColumn, type DataTableCardView } from '../../../shared/ui/data-table';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { Select } from '../../../shared/ui/select';
import { useConnectionsQuery } from '../../connections';
import { useDemoMode } from '../../system';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { RoutingParcelDialog } from './routing-parcel-dialog';
import {
  EMPTY_PARCEL_DRAFT,
  draftFromFields,
  draftToFields,
  draftsEqual,
  isDraftEmpty,
  summarizeParcelProfile,
  type ParcelProfileDraft,
} from '../lib/parcel-profile';
import { interpolate, useMessages } from '../../../shared/i18n';
import { useShippingRouteCopy } from '../hooks/use-shipping-route-copy';
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
import { describeApiError } from '../../../shared/api/describe-api-error';

interface RoutingRulesPanelProps {
  connectionId: string;
  /** Resolved source-platform label for user-facing copy (#1784), e.g. "Allegro". */
  sourceLabel: string;
  /** Source delivery methods to route - owned by the page's `useMappingOptions`. */
  deliveryMethods: MappingOption[];
  deliveryMethodsLoading: boolean;
  deliveryMethodsError: Error | null;
  /**
   * Reports the panel's dirty (unsaved-edits) state up so the page can guard a
   * tab switch that would discard staged routing edits (#1784 follow-up I3).
   */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Rendered inside a host that already names the task (the OMS Shipping step,
   * the routing dialog): drop the panel's own card, title and intro so the
   * operator reads one heading and one container, not three nested ones.
   */
  embedded?: boolean;
  /** A delivery method to put first and mark, e.g. the one the operator came from. */
  focusMethodId?: string;
}

/** Sentinel selection key meaning "no rule" → the default OMP fulfils the method. */
const DEFAULT_KEY = '__default__';

/** Virtualized-row height estimate; also caps the container to content (#1784 S17). */
const ROUTING_ROW_HEIGHT = 58;
const ROUTING_MAX_CONTAINER_HEIGHT = 520;
/** Extra height of a row that shows the default-parcel line under its select. */
const ROUTING_PARCEL_LINE_HEIGHT = 30;


const SHORT_VALUE_HEAD = 6;
const SHORT_VALUE_TAIL = 4;

/**
 * Truncates long ids for inline hints; short ids render verbatim (#474).
 *
 * Middle-ellipsis rather than front-truncation: some marketplaces (Erli) share
 * a long common prefix and carry the distinguishing part (weight/size) at the
 * END of the id, so `slice(0, 8)` collapsed whole groups into identical hints -
 * e.g. `erliDPDKurier5kg` / `…20kg` both became `erliDPDK…`. Keeping head + tail
 * preserves the distinguishing suffix (`erliDP…20kg`).
 */
function shortValue(value: string): string {
  if (value.length <= SHORT_VALUE_HEAD + SHORT_VALUE_TAIL + 1) return value;
  return `${value.slice(0, SHORT_VALUE_HEAD)}…${value.slice(-SHORT_VALUE_TAIL)}`;
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

/**
 * Which half of the choice an option belongs to. The select groups options by
 * it, so each option can be a short name and still read unambiguously.
 */
type RouteGroup = 'shop' | 'label';

interface DivertOption {
  key: string;
  label: string;
  group: RouteGroup;
}

export function RoutingRulesPanel({
  connectionId,
  sourceLabel,
  deliveryMethods,
  deliveryMethodsLoading,
  deliveryMethodsError,
  onDirtyChange,
  embedded = false,
  focusMethodId,
}: RoutingRulesPanelProps): ReactElement {
  const routeCopy = useShippingRouteCopy();
  const panelCopy = useMessages('mappings').routingRulesPanel;
  const parcelCopy = useMessages('mappings').parcelProfile;
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

  // Persisted parcel profile per method, as an editable cm / kg draft (#3652).
  const savedDraftByMethod = useMemo(() => {
    const map = new Map<string, ParcelProfileDraft>();
    for (const rule of savedRules) map.set(rule.sourceDeliveryMethodId, draftFromFields(rule));
    return map;
  }, [savedRules]);

  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const [profileDrafts, setProfileDrafts] = useState<Record<string, ParcelProfileDraft>>(() =>
    Object.fromEntries(savedDraftByMethod),
  );
  const [editingMethod, setEditingMethod] = useState<MappingOption | null>(null);

  const [selections, setSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(savedKeyByMethod),
  );

  // Resync local edits to server state after a successful save / refetch.
  useEffect(() => {
    setSelections(Object.fromEntries(savedKeyByMethod));
  }, [savedKeyByMethod]);
  useEffect(() => {
    setProfileDrafts(Object.fromEntries(savedDraftByMethod));
  }, [savedDraftByMethod]);

  const connectionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const conn of connectionsQuery.data ?? []) map.set(conn.id, conn.name);
    return map;
  }, [connectionsQuery.data]);

  const connName = useCallback(
    (id: string): string => connectionNameById.get(id) ?? shortValue(id),
    [connectionNameById],
  );

  const candidates = useMemo(() => candidatesQuery.data ?? [], [candidatesQuery.data]);

  // Default label is data-driven from the omp_fulfilled candidate (no hardcoded
  // platform name) — falls back to a generic phrase when none is reported.
  const ompCandidate = candidates.find((c) => c.processorKind === 'omp_fulfilled') ?? null;
  const shopName = ompCandidate ? connName(ompCandidate.processorConnectionId) : null;
  const defaultLabel = routeCopy.defaultOption(shopName);

  // Divert options exclude omp_fulfilled — that IS the default in v1; explicit
  // OMP pinning is the multi-OMP follow-up. Sorted by label so the divert menu
  // stays scannable (#1784 I8).
  const divertOptions: DivertOption[] = useMemo(
    () =>
      candidates
        .filter((c) => c.processorKind !== 'omp_fulfilled')
        .map((c) => ({
          key: `${c.processorKind}::${c.processorConnectionId}`,
          label:
            c.processorKind === 'source_brokered'
              ? routeCopy.sourceShipping(sourceLabel)
              : connName(c.processorConnectionId),
          group: 'label' as const,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [candidates, connName, sourceLabel, routeCopy],
  );

  // Render a row per delivery method, plus any saved rule whose method the
  // source no longer reports — so a replace-all save never silently drops it.
  const rowMethods = useMemo<MappingOption[]>(() => {
    const known = new Set(deliveryMethods.map((m) => m.value));
    const orphans: MappingOption[] = [];
    for (const methodId of savedKeyByMethod.keys()) {
      if (!known.has(methodId)) orphans.push({ value: methodId, label: methodId });
    }
    const rows = [...deliveryMethods, ...orphans];
    if (!focusMethodId) return rows;
    // The method the operator came from goes first, so they never hunt for it.
    return [...rows.filter((m) => m.value === focusMethodId), ...rows.filter((m) => m.value !== focusMethodId)];
  }, [deliveryMethods, savedKeyByMethod, focusMethodId]);

  const draftFor = useCallback(
    (methodId: string): ParcelProfileDraft => profileDrafts[methodId] ?? EMPTY_PARCEL_DRAFT,
    [profileDrafts],
  );

  const isDirty = rowMethods.some(
    (m) =>
      (selections[m.value] ?? DEFAULT_KEY) !== (savedKeyByMethod.get(m.value) ?? DEFAULT_KEY) ||
      // A profile only persists on a diverted method, so a staged profile on a
      // default-routed row is not a pending change.
      ((selections[m.value] ?? DEFAULT_KEY) !== DEFAULT_KEY &&
        !draftsEqual(draftFor(m.value), savedDraftByMethod.get(m.value) ?? EMPTY_PARCEL_DRAFT)),
  );

  // Surface the dirty signal up for the page-level discard guard (#1784 I3).
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

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
        // Brokered shipping is the source's own service, so it is named after the
        // marketplace ("Allegro shipping"), not after the source connection.
        const label = c.processorKind === 'source_brokered' ? routeCopy.sourceShipping(sourceLabel) : nameFor(c.processorConnectionId);
        return { key, label, count: counts.get(key) ?? 0 };
      });

    for (const [key, count] of counts) {
      if (key === DEFAULT_KEY || buckets.some((b) => b.key === key)) continue;
      const parsed = parseSelectionKey(key);
      buckets.push({
        key,
        label: parsed ? routeCopy.unavailable(nameFor(parsed.connectionId)) : key,
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
  }, [rowMethods, selections, candidates, defaultLabel, connectionNameById, sourceLabel, routeCopy]);

  const optionsForRow = useCallback(
    (currentKey: string): DivertOption[] => {
      const base: DivertOption[] = [
        { key: DEFAULT_KEY, label: routeCopy.defaultShort(shopName), group: 'shop' },
        ...divertOptions,
      ];
      // Keep a saved selection visible even when it is no longer a live candidate
      // (connection disabled, capability lost), so the operator can see + decide.
      if (currentKey !== DEFAULT_KEY && !base.some((o) => o.key === currentKey)) {
        const parsed = parseSelectionKey(currentKey);
        base.push({
          key: currentKey,
          label: parsed ? routeCopy.unavailable(connName(parsed.connectionId)) : currentKey,
          group: 'label',
        });
      }
      return base;
    },
    [shopName, divertOptions, connName, routeCopy],
  );

  const handleSelect = useCallback((methodId: string, key: string): void => {
    setSelections((prev) => ({ ...prev, [methodId]: key }));
  }, []);

  function handleSave(): void {
    const items: RoutingRuleInput[] = [];
    for (const method of rowMethods) {
      const key = selections[method.value] ?? DEFAULT_KEY;
      const parsed = parseSelectionKey(key);
      if (!parsed) continue;
      const draft = draftFor(method.value);
      const hadProfile = !isDraftEmpty(savedDraftByMethod.get(method.value) ?? EMPTY_PARCEL_DRAFT);
      // Profile keys are sent only when there is something to set or clear, so
      // a save against an API that predates the profile carries no unknown keys.
      const profile = !isDraftEmpty(draft) || hadProfile ? draftToFields(draft) : {};
      items.push({
        sourceDeliveryMethodId: method.value,
        processorKind: parsed.kind,
        processorConnectionId: parsed.connectionId,
        ...profile,
      });
    }
    replaceMutation.mutate({ items });
  }

  // Cell renderers memoized so the DataTable column literals stay stable and
  // don't re-prime the virtualizer on unrelated re-renders (#1784 I7). The
  // `method` cell is static; `routed`/`change` depend on `selections`.
  // A method's id is noise unless two methods share a name (Erli reports
  // weight-banded groups under one label), so it stays inline only then.
  const duplicateLabels = useMemo(() => {
    const seen = new Map<string, number>();
    for (const m of rowMethods) seen.set(m.label, (seen.get(m.label) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([label]) => label));
  }, [rowMethods]);

  const renderMethodLabel = useCallback(
    (method: MappingOption): ReactNode => {
      if (method.label === method.value) {
        return <span className="mono-text">{method.value}</span>;
      }
      if (duplicateLabels.has(method.label)) {
        return (
          <>
            {method.label}{' '}
            <span className="mapping-id-hint mono-text">{shortValue(method.value)}</span>
          </>
        );
      }
      return (
        <span className="routing-method" title={shortValue(method.value)}>
          {method.label}
          {method.value === focusMethodId ? <span className="routing-method__mark">{routeCopy.thisOrder}</span> : null}
        </span>
      );
    },
    [duplicateLabels, focusMethodId, routeCopy],
  );

  // NOTE (#1784 I8): the per-row divert picker stays a native <select> routed
  // through the shared `Select` wrapper (for the tokened focus ring) rather than
  // the searchable `Combobox`. The option set is tiny (compatible candidates +
  // default), so search is unnecessary; and a popover-combobox nested inside a
  // virtualized DataTable cell brings portal/focus fragility that isn't worth it
  // here. The raw id is already out of the option label (candidate name only).
  const renderProcessorSelect = useCallback(
    (method: MappingOption): ReactNode => {
      const currentKey = selections[method.value] ?? DEFAULT_KEY;
      return (
        <Select
          aria-label={interpolate(panelCopy.processorSelectLabel, { method: method.label })}
          value={currentKey}
          onChange={(e) => {
            handleSelect(method.value, e.target.value);
          }}
        >
          {(['shop', 'label'] as const).map((group) => {
            const options = optionsForRow(currentKey).filter((o) => o.group === group);
            if (options.length === 0) return null;
            return (
              <optgroup key={group} label={routeCopy.groupLabel[group]}>
                {options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </Select>
      );
    },
    [selections, optionsForRow, handleSelect, routeCopy],
  );

  const renderParcel = useCallback(
    (method: MappingOption): ReactNode => {
      if ((selections[method.value] ?? DEFAULT_KEY) === DEFAULT_KEY) return null;
      const draft = draftFor(method.value);
      const summary = isDraftEmpty(draft) ? null : summarizeParcelProfile(draftToFields(draft));
      return (
        <span className="routing-route-cell__parcel">
          <span className="routing-route-cell__parcel-value">
            {parcelCopy.columnHeader}: {summary ?? parcelCopy.noneSet.toLowerCase()}
          </span>
          {write.visible && (
            <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
              <button
                type="button"
                className="routing-route-cell__parcel-action"
                disabled={write.demoReadOnly}
                onClick={() => {
                  setEditingMethod(method);
                }}
              >
                {summary ? parcelCopy.editAction : parcelCopy.setAction}
              </button>
            </ReadOnlyLock>
          )}
        </span>
      );
    },
    [selections, draftFor, write.visible, write.demoReadOnly],
  );

  const columns = useMemo<DataTableColumn<MappingOption>[]>(
    () => [
      {
        id: 'method',
        header: routeCopy.methodColumn(sourceLabel),
        cell: (m) => renderMethodLabel(m),
      },
      {
        id: 'route',
        header: routeCopy.routeColumn,
        cell: (m) => (
          <div className="routing-route-cell">
            {renderProcessorSelect(m)}
            {renderParcel(m)}
          </div>
        ),
      },
    ],
    [sourceLabel, renderMethodLabel, renderProcessorSelect, renderParcel, routeCopy],
  );

  const cardView = useMemo<DataTableCardView<MappingOption>>(
    () => ({
      title: (m) => renderMethodLabel(m),
      detail: (m) => (
        <>
          {renderProcessorSelect(m)}
          {renderParcel(m)}
        </>
      ),
    }),
    [renderMethodLabel, renderProcessorSelect, renderParcel],
  );

  if (deliveryMethodsLoading || rulesQuery.isLoading || candidatesQuery.isLoading) {
    return (
      <LoadingState
        liveRegion="off"
        title={panelCopy.loading.title}
        message={panelCopy.loading.message}
      />
    );
  }

  const dataError = deliveryMethodsError ?? rulesQuery.error ?? candidatesQuery.error ?? null;
  if (dataError) {
    return <ErrorState title={panelCopy.errorTitle} message={describeApiError(dataError, 'mappings')} />;
  }

  // A row whose route buys a label carries the default-parcel line under its
  // select, so it is taller; sizing every row the same clipped the last ones.
  const labelledRows = rowMethods.filter((m) => (selections[m.value] ?? DEFAULT_KEY) !== DEFAULT_KEY).length;
  const containerHeight = Math.min(
    ROUTING_MAX_CONTAINER_HEIGHT,
    rowMethods.length * ROUTING_ROW_HEIGHT + labelledRows * ROUTING_PARCEL_LINE_HEIGHT + 8,
  );

  const dirtyBadge = isDirty ? (
    <span className="status-badge status-badge--warning" aria-live="polite">
      {panelCopy.unsaved}
    </span>
  ) : null;

  return (
    <div className={embedded ? 'routing-panel routing-panel--embedded' : 'panel panel--dense routing-panel'}>
      {embedded ? null : (
        <>
          <div className="panel__header">
            <h3 className="section-title">{routeCopy.panelTitle}</h3>
            {dirtyBadge}
          </div>
          <p className="muted-text routing-panel__intro">{routeCopy.intro(sourceLabel, shopName)}</p>
        </>
      )}

      {divertOptions.length === 0 && (
        <p
          className="muted-text"
          role="status"
          aria-live="polite"
          style={{ marginBottom: 'var(--space-3)' }}
        >
          {routeCopy.noCarrier}
        </p>
      )}

      {rowMethods.length > 0 && <RoutingSplitBar buckets={splitBuckets} />}

      {rowMethods.length === 0 ? (
        <p className="muted-text" role="status" aria-live="polite">
          {panelCopy.noMethods}
        </p>
      ) : (
        // Virtualized so hundreds of source delivery methods (Allegro) render
        // without lag (#1784 follow-up). DataTable auto-disables virtualization
        // and renders its `cardView` on narrow viewports, so the mobile layout
        // is preserved without the raw-table `.data-table--stackable` transform.
        <DataTable
          caption={panelCopy.caption}
          rows={rowMethods}
          rowKey={(m) => m.value}
          virtualize
          estimateRowHeight={ROUTING_ROW_HEIGHT}
          containerHeight={containerHeight}
          columns={columns}
          cardView={cardView}
        />
      )}

      {editingMethod && (
        <RoutingParcelDialog
          key={editingMethod.value}
          open
          methodLabel={editingMethod.label}
          initial={draftFor(editingMethod.value)}
          onApply={(draft) => {
            setProfileDrafts((prev) => ({ ...prev, [editingMethod.value]: draft }));
          }}
          onOpenChange={(next) => {
            if (!next) setEditingMethod(null);
          }}
        />
      )}

      {replaceMutation.error && (
        <p className="error-message" role="alert" style={{ marginTop: 'var(--space-2)' }}>
          {describeApiError(replaceMutation.error, 'mappings')}
        </p>
      )}

      <div className="routing-panel__actions">
        <Button tone="primary" disabled={!isDirty || replaceMutation.isPending} onClick={handleSave}>
          {replaceMutation.isPending ? panelCopy.saving : panelCopy.save}
        </Button>
        {replaceMutation.error && (
          <Button tone="secondary" disabled={replaceMutation.isPending} onClick={handleSave}>
            {panelCopy.tryAgain}
          </Button>
        )}
        {embedded ? dirtyBadge : null}
      </div>
    </div>
  );
}
