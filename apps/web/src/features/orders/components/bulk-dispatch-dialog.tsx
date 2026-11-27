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
import { Fragment, useMemo, useReducer, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import {
  interpolate,
  useFormat,
  useMessages,
  usePlural,
  type Messages,
  type ResolvedCopy,
} from '../../../shared/i18n';
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
  dispatchIneligibilityHint,
  dispatchIneligibilityLabel,
  type DispatchEligibility,
} from '../lib/dispatch-input';
import {
  mergeParcelWithRoutedPrefill,
  parcelPrefillFromFields,
  type RoutedParcelPrefill,
} from '../lib/routed-parcel-profile';
import { createParcelSchema, type ParcelSubmission } from './bulk-dispatch-dialog.schema';
import { describeApiError } from '../../../shared/api/describe-api-error';

type BulkDispatchCopy = ResolvedCopy<Messages['orders']>['bulkDispatchDialog'];

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
  const ordersCopy = useMessages('orders');
  const copy = ordersCopy.bulkDispatchDialog;
  const plural = usePlural();
  const format = useFormat();
  const parcelSchema = useMemo(
    () => createParcelSchema(ordersCopy.generateLabelForm.validation),
    [ordersCopy],
  );
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

  // Per-order default parcel from the routing rule its delivery method matches
  // (#3652). Precedence per row: explicit row override > the dialog-wide default
  // box (field by field, where filled) > the routed profile. Read from each
  // order's `deliveryResolution` (#3958): the routing-rules endpoint is
  // admin-only, so an operator lost the prefill without any sign of it.
  const routedByOrder = useMemo(() => {
    const map = new Map<string, RoutedParcelPrefill | null>();
    for (const e of eligible) {
      map.set(e.order.internalOrderId, parcelPrefillFromFields(e.order.deliveryResolution?.parcelProfile));
    }
    return map;
  }, [eligible]);

  const rowParcel = (orderId: string): ParcelFields =>
    overrides[orderId] ?? mergeParcelWithRoutedPrefill(profile, routedByOrder.get(orderId) ?? null);

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
        errors[id] = parsed.error.issues[0]?.message ?? copy.invalidParcel;
        continue;
      }
      const parcel: ParcelSubmission = parsed.data;
      items.push({
        sourceConnectionId: entry.order.sourceConnectionId,
        item: buildDispatchItem({
          order: entry.order,
          snapshot: entry.snapshot,
          shippingMethod: entry.shippingMethod,
          parcel:
            entry.shippingMethod === 'paczkomat' && routedByOrder.get(id)?.template
              ? { ...parcel, template: routedByOrder.get(id)?.template }
              : parcel,
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
        const error = describeApiError(outcome.reason, 'orders');
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
      title: copy.toast.title,
      description:
        failed > 0
          ? interpolate(copy.toast.summaryWithFailed, {
              dispatched: format.number(dispatched),
              failed: format.number(failed),
            })
          : interpolate(copy.toast.summary, { dispatched: format.number(dispatched) }),
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
            <DialogTitle>
              {eligible.length === orders.length
                ? plural(orders.length, copy.title)
                : plural(orders.length, copy.titlePartial, {
                    count: format.number(eligible.length),
                  })}
            </DialogTitle>
            <DialogDescription id="bulk-dispatch-desc">{copy.description}</DialogDescription>

            <fieldset disabled={phase === 'submitting'} className="bulk-dispatch__body">
              <ParcelProfile profile={profile} onChange={setProfile} onApplyAll={applyProfileToAll} />

              <p className="bulk-dispatch__summary">
                <strong>{interpolate(copy.ready, { n: format.number(eligible.length) })}</strong>
                {ineligible.length > 0 ? (
                  <>
                    {' · '}
                    {plural(ineligible.length, copy.needAttention)}
                  </>
                ) : null}
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
                <p className="bulk-dispatch__note">{plural(eligible.length, copy.onlyReady)}</p>
              ) : null}
              {eligible.length === 0 ? (
                <Alert tone="warning">{copy.noneEligible}</Alert>
              ) : null}
            </fieldset>

            <DialogFooter>
              <Button tone="ghost" onClick={resetAndClose} disabled={phase === 'submitting'}>
                {copy.cancel}
              </Button>
              <Button
                tone="primary"
                onClick={() => void handleSubmit()}
                disabled={eligible.length === 0 || phase === 'submitting'}
              >
                {phase === 'submitting' ? copy.dispatching : plural(eligible.length, copy.submit)}
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
  const copy = useMessages('orders').bulkDispatchDialog.profile;
  const set = (field: keyof ParcelFields) => (value: string) => onChange({ ...profile, [field]: value });
  return (
    <div className="bulk-dispatch__profile">
      <div className="bulk-dispatch__profile-fields">
        <div className="bulk-dispatch__field">
          <span className="bulk-dispatch__field-label">{copy.dimensions}</span>
          <div className="bulk-dispatch__dims">
            <DimInput label={copy.defaultLengthAria} value={profile.length} onChange={set('length')} />
            <span className="bulk-dispatch__times">×</span>
            <DimInput label={copy.defaultWidthAria} value={profile.width} onChange={set('width')} />
            <span className="bulk-dispatch__times">×</span>
            <DimInput label={copy.defaultHeightAria} value={profile.height} onChange={set('height')} />
          </div>
        </div>
        <div className="bulk-dispatch__field bulk-dispatch__weight">
          <span className="bulk-dispatch__field-label">{copy.weight}</span>
          <DimInput label={copy.defaultWeightAria} value={profile.weightGrams} onChange={set('weightGrams')} wide />
        </div>
        <Button tone="secondary" className="button--sm bulk-dispatch__apply" onClick={onApplyAll}>
          {copy.applyAll}
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

/**
 * Split an internal id into wrap-safe chunks: the `ol_{type}_` prefix as one
 * chunk, then the remaining opaque id in fixed-size groups (#2669). Rendered
 * with `<wbr>` between chunks so the browser only wraps at these explicit
 * points - never at `overflow-wrap: anywhere`, which broke the id one
 * character per line once its column narrowed (#1658).
 */
export function splitIdForWrap(id: string, chunkSize = 6): string[] {
  const prefixMatch = /^[a-z]+_[a-z]+_/.exec(id);
  const prefix = prefixMatch?.[0] ?? '';
  const rest = id.slice(prefix.length);
  if (rest.length === 0) return prefix ? [prefix] : [id];
  const restChunks: string[] = [];
  for (let i = 0; i < rest.length; i += chunkSize) {
    restChunks.push(rest.slice(i, i + chunkSize));
  }
  // Fold a dangling remainder shorter than chunkSize into the previous chunk
  // instead of giving it its own wrap point.
  if (restChunks.length > 1 && restChunks[restChunks.length - 1].length < chunkSize) {
    const last = restChunks.pop()!;
    restChunks[restChunks.length - 1] += last;
  }
  return prefix ? [prefix, ...restChunks] : restChunks;
}

/** Renders an order id with controlled wrap points and the full value as a
 *  hover title (the visible text is still capped at 2 lines by CSS). */
function WrappableOrderId({ id }: { id: string }): ReactElement {
  const chunks = splitIdForWrap(id);
  return (
    <span className="mono bulk-dispatch__ordid" title={id}>
      {chunks.map((chunk, i) => (
        <Fragment key={i}>
          {chunk}
          {i < chunks.length - 1 ? <wbr /> : null}
        </Fragment>
      ))}
    </span>
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
  const copy = useMessages('orders').bulkDispatchDialog.row;
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
        <WrappableOrderId id={ref} />
        {buyer ? <span className="text-muted bulk-dispatch__buyer">{buyer}</span> : null}
      </div>
      <StatusBadge tone={shippingMethod === 'paczkomat' ? 'info' : 'neutral'} compact>
        {shippingMethod === 'paczkomat' ? copy.paczkomat : copy.courier}
      </StatusBadge>
      <div className="bulk-dispatch__parcel-fields">
        <div className="bulk-dispatch__dims">
          <DimInput label={interpolate(copy.lengthFor, { ref })} value={parcel.length} onChange={(v) => onField('length', v)} />
          <span className="bulk-dispatch__times">×</span>
          <DimInput label={interpolate(copy.widthFor, { ref })} value={parcel.width} onChange={(v) => onField('width', v)} />
          <span className="bulk-dispatch__times">×</span>
          <DimInput label={interpolate(copy.heightFor, { ref })} value={parcel.height} onChange={(v) => onField('height', v)} />
        </div>
        <div className="bulk-dispatch__weight">
          <DimInput label={interpolate(copy.weightFor, { ref })} value={parcel.weightGrams} onChange={(v) => onField('weightGrams', v)} wide />
        </div>
        <StatusBadge tone="success" withDot compact>
          {copy.ready}
        </StatusBadge>
      </div>
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
  const ordersCopy = useMessages('orders');
  const copy = ordersCopy.bulkDispatchDialog.row;
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
        <WrappableOrderId id={ref} />
        {buyer ? <span className="text-muted bulk-dispatch__buyer">{buyer}</span> : null}
      </div>
      <StatusBadge tone="warning" withDot compact>
        {reason ? dispatchIneligibilityLabel(reason, ordersCopy.dispatchInput) : copy.notDispatchable}
      </StatusBadge>
      <span className="bulk-dispatch__row-hint">
        {reason ? dispatchIneligibilityHint(reason, ordersCopy.dispatchInput) : ''}{' '}
        <Link className="bulk-dispatch__link" to={`/orders/${ref}`}>
          {copy.dispatchIndividually} <span aria-hidden="true">›</span>
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
function resultLabel(
  kind: PerOrderDispatchResult['kind'],
  copy: BulkDispatchCopy['result']['status'],
): string {
  switch (kind) {
    case 'dispatched':
      return copy.dispatched;
    case 'omp_fulfilled':
      return copy.ompFulfilled;
    case 'failed':
      return copy.failed;
  }
}

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
  const copy = useMessages('orders').bulkDispatchDialog.result;
  const format = useFormat();
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
      carrierLabel:
        getCarrierDisplayName(group[0]?.shipment.carrier ?? null) ?? copy.protocolCarrierFallback,
      shipmentIds: group.map((g) => g.shipment.id),
    }));
  }, [results, copy]);

  return (
    <>
      <DialogTitle>{copy.title}</DialogTitle>
      <DialogDescription id="bulk-dispatch-desc">
        <strong>{interpolate(copy.dispatched, { n: format.number(dispatchedCount) })}</strong>
        {omp > 0 ? (
          <>
            {' · '}
            {interpolate(copy.fulfilledByStore, { n: format.number(omp) })}
          </>
        ) : null}
        {failed > 0 ? (
          <>
            {' · '}
            {interpolate(copy.failed, { n: format.number(failed) })}
          </>
        ) : null}
      </DialogDescription>

      <div className="bulk-dispatch__results">
        {results.map((r) => (
          <div key={r.orderId} className="bulk-dispatch__result-row">
            <span className="mono bulk-dispatch__ordid">{r.orderId}</span>
            <StatusBadge tone={RESULT_TONE[r.kind]} withDot compact>
              {resultLabel(r.kind, copy.status)}
            </StatusBadge>
            {r.kind === 'failed' ? <span className="bulk-dispatch__result-detail text-muted">{r.error}</span> : null}
            {r.kind === 'dispatched' ? (
              <span className="bulk-dispatch__result-detail text-muted">{copy.trackingSoon}</span>
            ) : null}
          </div>
        ))}
      </div>

      <DialogFooter className="bulk-dispatch__result-footer">
        {carrierGroups.length > 0 ? (
          <div className="bulk-dispatch__protocols">
            <span className="text-muted bulk-dispatch__protocols-label">{copy.protocolLabel}</span>
            {carrierGroups.map((g) => (
              <Button
                key={g.connectionId}
                tone="secondary"
                className="button--sm"
                disabled={protocolDownloading}
                onClick={() => onDownloadProtocol(g.shipmentIds, g.carrierLabel)}
              >
                <span aria-hidden="true">⤓</span>{' '}
                {interpolate(copy.protocolButton, {
                  carrier: g.carrierLabel,
                  n: format.number(g.shipmentIds.length),
                })}
              </Button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <Button tone="primary" onClick={onClose}>
          {copy.close}
        </Button>
      </DialogFooter>
    </>
  );
}
