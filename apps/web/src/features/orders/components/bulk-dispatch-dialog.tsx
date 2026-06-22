/**
 * Bulk Dispatch Dialog (#1109)
 *
 * Batch label-generation for a multi-select of orders. Three phases:
 *  1. compose  — shared parcel profile + per-order override rows; ineligible
 *     orders surfaced with a reason (never silently dropped).
 *  2. submitting — groups eligible orders by source connection and fans out one
 *     `bulkGenerateLabels` call per group (`Promise.allSettled`), so one source's
 *     failure doesn't sink the others.
 *  3. result   — merged per-order outcomes; dispatched shipments grouped by
 *     carrier connection, with one handover-protocol download per carrier.
 *
 * Per-order overrides validate against the SAME parcel schema as the shared
 * profile, so a row can't submit dims the single-order form would reject.
 *
 * @module apps/web/src/features/orders/components
 */
import { useMemo, useReducer, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from '../../../shared/ui/dialog';
import { Input } from '../../../shared/ui/input';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useToast } from '../../../shared/ui/toast-provider';
import {
  useBulkGenerateLabelsMutation,
  useProtocolDownload,
  getCarrierDisplayName,
  type BulkDispatchItem,
  type PerOrderDispatchResult,
  type Shipment,
} from '../../shipments';

import type { OrderRecord } from '../api/orders.types';
import {
  buildDispatchItem,
  classifyDispatchEligibility,
  groupBy,
  DISPATCH_INELIGIBILITY_LABEL,
  DISPATCH_INELIGIBILITY_HINT,
  type DispatchEligibility,
} from '../lib/dispatch-input';
import { parcelSchema, type ParcelSubmission } from './bulk-dispatch-dialog.schema';

interface BulkDispatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected orders to dispatch (may span source connections). */
  orders: readonly OrderRecord[];
  /** connectionId → human channel label, for the per-row source pill. */
  channelLabelFor: (connectionId: string) => string;
  /** Called after a batch completes so the page can clear its selection. */
  onComplete: () => void;
}

/** RHF-free parcel field values as the inputs hold them (strings). */
interface ParcelFields {
  length: string;
  width: string;
  height: string;
  weightGrams: string;
}

const EMPTY_PARCEL: ParcelFields = { length: '', width: '', height: '', weightGrams: '' };

type OverrideState = Record<string, ParcelFields>;
type OverrideAction =
  | { type: 'set'; orderId: string; field: keyof ParcelFields; value: string }
  | { type: 'applyAll'; ids: string[]; parcel: ParcelFields }
  | { type: 'reset' };

function overrideReducer(state: OverrideState, action: OverrideAction): OverrideState {
  switch (action.type) {
    case 'set':
      return {
        ...state,
        [action.orderId]: { ...(state[action.orderId] ?? EMPTY_PARCEL), [action.field]: action.value },
      };
    case 'applyAll': {
      const next: OverrideState = { ...state };
      for (const id of action.ids) next[id] = { ...action.parcel };
      return next;
    }
    case 'reset':
      return {};
  }
}

/** A dispatched per-order result paired with its shipment (for carrier grouping). */
interface DispatchedResult {
  orderId: string;
  shipment: Shipment;
}

export function BulkDispatchDialog({
  open,
  onOpenChange,
  orders,
  channelLabelFor,
  onComplete,
}: BulkDispatchDialogProps): ReactElement {
  const { showToast } = useToast();
  const mutation = useBulkGenerateLabelsMutation();
  const protocolDownload = useProtocolDownload();

  // Classify once per open selection. Eligible rows feed the batch; ineligible
  // rows are shown with a reason.
  const classified = useMemo<DispatchEligibility[]>(
    () => orders.map((o) => classifyDispatchEligibility(o)),
    [orders],
  );
  const eligible = useMemo(() => classified.filter((c) => c.eligible), [classified]);
  const ineligible = useMemo(() => classified.filter((c) => !c.eligible), [classified]);

  // Shared parcel profile (top of dialog). Plain local state — applied to rows
  // via "Apply to all rows"; per-row overrides hold the authoritative values.
  const [profile, setProfile] = useState<ParcelFields>(EMPTY_PARCEL);
  const [overrides, dispatchOverride] = useReducer(overrideReducer, {} as OverrideState);
  const [phase, setPhase] = useState<'compose' | 'submitting' | 'result'>('compose');
  const [results, setResults] = useState<PerOrderDispatchResult[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const rowParcel = (orderId: string): ParcelFields => overrides[orderId] ?? profile;

  function applyProfileToAll(): void {
    dispatchOverride({ type: 'applyAll', ids: eligible.map((e) => e.order.internalOrderId), parcel: profile });
  }

  function resetAndClose(): void {
    setPhase('compose');
    setResults([]);
    setRowErrors({});
    // Clear the operator-entered parcel state too, so a later open with a
    // different selection starts clean rather than showing the prior batch's
    // dims + stale per-order overrides.
    setProfile(EMPTY_PARCEL);
    dispatchOverride({ type: 'reset' });
    onOpenChange(false);
  }

  async function handleSubmit(): Promise<void> {
    // Validate each eligible row's effective parcel against the shared schema —
    // an override can't submit dims the single-order form would reject.
    const errors: Record<string, string> = {};
    const items: { sourceConnectionId: string; item: BulkDispatchItem }[] = [];
    for (const entry of eligible) {
      const id = entry.order.internalOrderId;
      const parsed = parcelSchema.safeParse(rowParcel(id));
      if (!parsed.success) {
        errors[id] = parsed.error.issues[0]?.message ?? 'Invalid parcel';
        continue;
      }
      const parcel: ParcelSubmission = parsed.data;
      items.push({
        sourceConnectionId: entry.order.sourceConnectionId,
        item: buildDispatchItem({
          order: entry.order,
          snapshot: entry.snapshot,
          shippingMethod: entry.shippingMethod,
          parcel,
          paczkomatId: entry.paczkomatId,
        }),
      });
    }
    if (Object.keys(errors).length > 0) {
      setRowErrors(errors);
      return;
    }
    setRowErrors({});
    setPhase('submitting');

    // Group by source connection and fan out one request per group.
    const groups = groupBy(items, (i) => i.sourceConnectionId);
    const settled = await Promise.allSettled(
      Array.from(groups.entries()).map(([sourceConnectionId, groupItems]) =>
        mutation.mutateAsync({ sourceConnectionId, items: groupItems.map((g) => g.item) }),
      ),
    );

    // Merge per-order results. A rejected group has no per-order rows — synthesize
    // a `failed` outcome for every order in it so nothing silently vanishes.
    const merged: PerOrderDispatchResult[] = [];
    const groupEntries = Array.from(groups.entries());
    settled.forEach((outcome, index) => {
      const [, groupItems] = groupEntries[index];
      if (outcome.status === 'fulfilled') {
        merged.push(...outcome.value.results);
      } else {
        const error = outcome.reason instanceof Error ? outcome.reason.message : 'Dispatch failed';
        for (const g of groupItems) {
          merged.push({ kind: 'failed', orderId: g.item.orderId, error });
        }
      }
    });

    setResults(merged);
    setPhase('result');

    const dispatched = merged.filter((r) => r.kind === 'dispatched').length;
    const failed = merged.filter((r) => r.kind === 'failed').length;
    showToast({
      tone: failed > 0 ? (dispatched > 0 ? 'warning' : 'error') : 'success',
      title: 'Batch complete',
      description: `${dispatched} dispatched${failed > 0 ? ` · ${failed} failed` : ''}.`,
    });
    onComplete();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="bulk-dispatch" aria-describedby="bulk-dispatch-desc">
        {phase === 'result' ? (
          <ResultView
            results={results}
            protocolDownloading={protocolDownload.isDownloading}
            onDownloadProtocol={(ids, label) => void protocolDownload.download(ids, label)}
            onClose={resetAndClose}
          />
        ) : (
          <>
            <DialogTitle>Dispatch {eligible.length === orders.length ? orders.length : `${eligible.length} of ${orders.length}`} orders</DialogTitle>
            <DialogDescription id="bulk-dispatch-desc">
              Generate labels for the selected orders — dispatched in per-source batches.
            </DialogDescription>

            <fieldset disabled={phase === 'submitting'} className="bulk-dispatch__body">
              <ParcelProfile profile={profile} onChange={setProfile} onApplyAll={applyProfileToAll} />

              <p className="bulk-dispatch__summary">
                <strong>{eligible.length} ready</strong>
                {ineligible.length > 0
                  ? ` · ${ineligible.length} need attention — fix at source or dispatch individually`
                  : ''}
              </p>

              <div className="bulk-dispatch__rows">
                {eligible.map((entry) => (
                  <EligibleRow
                    key={entry.order.internalOrderId}
                    entry={entry}
                    channelLabelFor={channelLabelFor}
                    parcel={rowParcel(entry.order.internalOrderId)}
                    error={rowErrors[entry.order.internalOrderId]}
                    onField={(field, value) =>
                      dispatchOverride({ type: 'set', orderId: entry.order.internalOrderId, field, value })
                    }
                  />
                ))}
                {ineligible.map((entry) => (
                  <IneligibleRow key={entry.order.internalOrderId} entry={entry} channelLabelFor={channelLabelFor} />
                ))}
              </div>

              {ineligible.length > 0 && eligible.length > 0 ? (
                <p className="bulk-dispatch__note">Only the {eligible.length} ready orders will be dispatched.</p>
              ) : null}
              {eligible.length === 0 ? (
                <Alert tone="warning">None of the selected orders can be bulk-dispatched. Dispatch them individually from each order.</Alert>
              ) : null}
            </fieldset>

            <DialogFooter>
              <Button tone="ghost" onClick={resetAndClose} disabled={phase === 'submitting'}>
                Cancel
              </Button>
              <Button
                tone="primary"
                onClick={() => void handleSubmit()}
                disabled={eligible.length === 0 || phase === 'submitting'}
              >
                {phase === 'submitting' ? 'Dispatching…' : `Dispatch ${eligible.length} order${eligible.length === 1 ? '' : 's'}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ParcelProfile({
  profile,
  onChange,
  onApplyAll,
}: {
  profile: ParcelFields;
  onChange: (next: ParcelFields) => void;
  onApplyAll: () => void;
}): ReactElement {
  const set = (field: keyof ParcelFields) => (value: string) => onChange({ ...profile, [field]: value });
  return (
    <div className="bulk-dispatch__profile">
      <div className="bulk-dispatch__profile-fields">
        <div className="bulk-dispatch__field">
          <span className="bulk-dispatch__field-label">Dimensions (mm)</span>
          <div className="bulk-dispatch__dims">
            <DimInput label="Default length in millimetres" value={profile.length} onChange={set('length')} />
            <span className="bulk-dispatch__times">×</span>
            <DimInput label="Default width in millimetres" value={profile.width} onChange={set('width')} />
            <span className="bulk-dispatch__times">×</span>
            <DimInput label="Default height in millimetres" value={profile.height} onChange={set('height')} />
          </div>
        </div>
        <div className="bulk-dispatch__field">
          <span className="bulk-dispatch__field-label">Weight (g)</span>
          <DimInput label="Default weight in grams" value={profile.weightGrams} onChange={set('weightGrams')} wide />
        </div>
        <Button tone="secondary" className="button--sm bulk-dispatch__apply" onClick={onApplyAll}>
          Apply to all rows
        </Button>
      </div>
    </div>
  );
}

function DimInput({
  label,
  value,
  onChange,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean;
}): ReactElement {
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={1}
      aria-label={label}
      className={wide ? 'bulk-dispatch__num bulk-dispatch__num--wide' : 'bulk-dispatch__num'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function EligibleRow({
  entry,
  channelLabelFor,
  parcel,
  error,
  onField,
}: {
  entry: DispatchEligibility;
  channelLabelFor: (connectionId: string) => string;
  parcel: ParcelFields;
  error?: string;
  onField: (field: keyof ParcelFields, value: string) => void;
}): ReactElement {
  const { order, snapshot, shippingMethod } = entry;
  const ref = order.internalOrderId;
  const buyer = [snapshot.shippingAddress?.firstName, snapshot.shippingAddress?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return (
    <div className="bulk-dispatch__row">
      <div className="bulk-dispatch__row-id">
        <span className="bulk-dispatch__src">{channelLabelFor(order.sourceConnectionId)}</span>
        <span className="mono bulk-dispatch__ordid">{ref}</span>
        {buyer ? <span className="text-muted bulk-dispatch__buyer">{buyer}</span> : null}
      </div>
      <StatusBadge tone={shippingMethod === 'paczkomat' ? 'info' : 'neutral'} compact>
        {shippingMethod === 'paczkomat' ? 'Paczkomat' : 'Courier'}
      </StatusBadge>
      <div className="bulk-dispatch__dims">
        <DimInput label={`Length for ${ref}`} value={parcel.length} onChange={(v) => onField('length', v)} />
        <span className="bulk-dispatch__times">×</span>
        <DimInput label={`Width for ${ref}`} value={parcel.width} onChange={(v) => onField('width', v)} />
        <span className="bulk-dispatch__times">×</span>
        <DimInput label={`Height for ${ref}`} value={parcel.height} onChange={(v) => onField('height', v)} />
      </div>
      <DimInput label={`Weight for ${ref}`} value={parcel.weightGrams} onChange={(v) => onField('weightGrams', v)} wide />
      <StatusBadge tone="success" withDot compact>
        Ready
      </StatusBadge>
      {error ? <span className="bulk-dispatch__row-error" role="alert">{error}</span> : null}
    </div>
  );
}

function IneligibleRow({
  entry,
  channelLabelFor,
}: {
  entry: DispatchEligibility;
  channelLabelFor: (connectionId: string) => string;
}): ReactElement {
  const { order, snapshot, reason } = entry;
  const ref = order.internalOrderId;
  const buyer = [snapshot.shippingAddress?.firstName, snapshot.shippingAddress?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return (
    <div className="bulk-dispatch__row bulk-dispatch__row--ineligible">
      <div className="bulk-dispatch__row-id">
        <span className="bulk-dispatch__src">{channelLabelFor(order.sourceConnectionId)}</span>
        <span className="mono bulk-dispatch__ordid">{ref}</span>
        {buyer ? <span className="text-muted bulk-dispatch__buyer">{buyer}</span> : null}
      </div>
      <span className="bulk-dispatch__row-spacer" aria-hidden="true" />
      <StatusBadge tone="warning" withDot compact>
        {reason ? DISPATCH_INELIGIBILITY_LABEL[reason] : 'Not dispatchable'}
      </StatusBadge>
      <span className="bulk-dispatch__row-hint">
        {reason ? DISPATCH_INELIGIBILITY_HINT[reason] : ''}{' '}
        <Link className="bulk-dispatch__link" to={`/orders/${ref}`}>
          dispatch individually ›
        </Link>
      </span>
    </div>
  );
}

const RESULT_TONE: Record<PerOrderDispatchResult['kind'], StatusBadgeTone> = {
  dispatched: 'success',
  omp_fulfilled: 'info',
  failed: 'error',
};
const RESULT_LABEL: Record<PerOrderDispatchResult['kind'], string> = {
  dispatched: 'Dispatched',
  omp_fulfilled: 'Fulfilled by store',
  failed: 'Failed',
};

function ResultView({
  results,
  protocolDownloading,
  onDownloadProtocol,
  onClose,
}: {
  results: PerOrderDispatchResult[];
  protocolDownloading: boolean;
  onDownloadProtocol: (shipmentIds: string[], carrierLabel: string) => void;
  onClose: () => void;
}): ReactElement {
  const dispatchedCount = results.filter((r) => r.kind === 'dispatched').length;
  const failed = results.filter((r) => r.kind === 'failed').length;
  const omp = results.filter((r) => r.kind === 'omp_fulfilled').length;

  // Group dispatched shipments by carrier connection — the protocol endpoint
  // rejects mixed-carrier batches, so one download per carrier connection.
  // Derive `dispatched` inside the memo so the dep is the stable `results` ref.
  const carrierGroups = useMemo(() => {
    const dr: DispatchedResult[] = results
      .filter((r): r is Extract<PerOrderDispatchResult, { kind: 'dispatched' }> => r.kind === 'dispatched')
      .map((r) => ({ orderId: r.orderId, shipment: r.shipment }));
    return Array.from(groupBy(dr, (d) => d.shipment.connectionId).entries()).map(([connectionId, group]) => ({
      connectionId,
      carrierLabel: getCarrierDisplayName(group[0]?.shipment.carrier ?? null) ?? 'Carrier',
      shipmentIds: group.map((g) => g.shipment.id),
    }));
  }, [results]);

  return (
    <>
      <DialogTitle>Batch complete</DialogTitle>
      <DialogDescription id="bulk-dispatch-desc">
        <strong>{dispatchedCount} dispatched</strong>
        {omp > 0 ? ` · ${omp} fulfilled by store` : ''}
        {failed > 0 ? ` · ${failed} failed` : ''}
      </DialogDescription>

      <div className="bulk-dispatch__results">
        {results.map((r) => (
          <div key={r.orderId} className="bulk-dispatch__result-row">
            <span className="mono bulk-dispatch__ordid">{r.orderId}</span>
            <StatusBadge tone={RESULT_TONE[r.kind]} withDot compact>
              {RESULT_LABEL[r.kind]}
            </StatusBadge>
            {r.kind === 'failed' ? <span className="bulk-dispatch__result-detail text-muted">{r.error}</span> : null}
            {r.kind === 'dispatched' ? (
              <span className="bulk-dispatch__result-detail text-muted">tracking appears within ~5 min</span>
            ) : null}
          </div>
        ))}
      </div>

      <DialogFooter className="bulk-dispatch__result-footer">
        {carrierGroups.length > 0 ? (
          <div className="bulk-dispatch__protocols">
            <span className="text-muted bulk-dispatch__protocols-label">Handover protocol:</span>
            {carrierGroups.map((g) => (
              <Button
                key={g.connectionId}
                tone="secondary"
                className="button--sm"
                disabled={protocolDownloading}
                onClick={() => onDownloadProtocol(g.shipmentIds, g.carrierLabel)}
              >
                ⤓ {g.carrierLabel} ({g.shipmentIds.length})
              </Button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <Button tone="primary" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}
