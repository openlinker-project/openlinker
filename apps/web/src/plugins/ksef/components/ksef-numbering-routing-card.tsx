/**
 * KSeF numbering — document routing card (#1694)
 *
 * Maps each KSeF FA(3) document variant (VAT / KOR / ZAL / …) to the numbering
 * series that supplies its number. Routing is per-connection and multi-axis: a
 * row exists per `(documentType, register, currency, source)` combination
 * present among the series/routes of that document type, where the default
 * (all-wildcard) row is always shown. Each axis renders `any` when it is a
 * wildcard (`null`). Backed by the numbering-routes endpoints: choosing a series
 * upserts the route for that combination, choosing "Not assigned" detaches it
 * (the series survives). A "+ Add route" form creates a route scoped to a
 * specific register / currency / source. A Resolution-order panel visualizes the
 * most-specific-match-wins fallback (drop source -> currency -> register ->
 * default) on a live example so an operator can see which route a given document
 * would resolve to.
 *
 * @module plugins/ksef/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import {
  useDeleteNumberingRouteMutation,
  useUpsertNumberingRouteMutation,
  type DocumentType,
  type NumberingRoute,
  type NumberingSeries,
} from '../../../features/invoicing';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import { KSEF_ROUTED_DOCUMENT_TYPES, type KsefRoutedDocumentType } from './ksef-numbering.lib';

/** A create-editor prefill carried from the row the operator clicked. */
export interface RoutingSeriesPrefill {
  documentType: DocumentType;
  register: string | null;
}

interface KsefNumberingRoutingCardProps {
  connectionId: string;
  series: NumberingSeries[];
  routes: NumberingRoute[];
  readOnly: boolean;
  onAddSeries: (prefill: RoutingSeriesPrefill) => void;
}

/** One rendered routing row: a document type scoped to optional axes. */
interface RoutingRow {
  key: string;
  doc: KsefRoutedDocumentType;
  register: string | null;
  currency: string | null;
  source: string | null;
}

/** Wildcard display for a null axis. */
const ANY = 'any';

function axisKey(register: string | null, currency: string | null, source: string | null): string {
  return `${register ?? ''}::${currency ?? ''}::${source ?? ''}`;
}

function seriesOption(series: NumberingSeries): string {
  return `${series.name} — ${series.pattern}`;
}

function routeMatchesAxes(
  route: NumberingRoute,
  register: string | null,
  currency: string | null,
  source: string | null,
): boolean {
  return route.register === register && route.currency === currency && route.source === source;
}

/**
 * Enumerate the routing rows: the default (all-wildcard) row for every document
 * type, plus one extra row per distinct `(register, currency, source)`
 * combination that appears among that type's existing routes — and per register
 * present among that type's series (currency/source wildcard) so a
 * register-scoped series stays reachable. This keeps every existing route (and
 * register-scoped series) visible and editable rather than silently unreachable.
 */
function buildRoutingRows(series: NumberingSeries[], routes: NumberingRoute[]): RoutingRow[] {
  const rows: RoutingRow[] = [];
  for (const doc of KSEF_ROUTED_DOCUMENT_TYPES) {
    const combos = new Map<string, { register: string | null; currency: string | null; source: string | null }>();
    // Always include the all-wildcard default.
    combos.set(axisKey(null, null, null), { register: null, currency: null, source: null });
    for (const s of series) {
      if (s.documentType === doc.documentType && s.register !== null) {
        combos.set(axisKey(s.register, null, null), {
          register: s.register,
          currency: null,
          source: null,
        });
      }
    }
    for (const r of routes) {
      if (r.documentType === doc.documentType) {
        combos.set(axisKey(r.register, r.currency, r.source), {
          register: r.register,
          currency: r.currency,
          source: r.source,
        });
      }
    }
    for (const [comboKey, combo] of combos) {
      rows.push({ key: `${doc.documentType}::${comboKey}`, doc, ...combo });
    }
  }
  return rows;
}

/** Trim to a wildcard: empty/blank -> null. */
function normalizeAxis(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function KsefNumberingRoutingCard({
  connectionId,
  series,
  routes,
  readOnly,
  onAddSeries,
}: KsefNumberingRoutingCardProps): ReactElement {
  const upsertRoute = useUpsertNumberingRouteMutation();
  const deleteRoute = useDeleteNumberingRouteMutation();
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  async function applyRoute(row: RoutingRow, seriesId: string): Promise<void> {
    setError(null);
    const scope = describeScope(row.register, row.currency, row.source);
    try {
      if (seriesId === '') {
        await deleteRoute.mutateAsync({
          connectionId,
          input: {
            documentType: row.doc.documentType,
            register: row.register,
            currency: row.currency,
            source: row.source,
          },
        });
        showToast({
          tone: 'success',
          title: 'Route removed',
          description: `${row.doc.label}${scope} is no longer routed.`,
        });
      } else {
        await upsertRoute.mutateAsync({
          connectionId,
          input: {
            documentType: row.doc.documentType,
            register: row.register,
            currency: row.currency,
            source: row.source,
            seriesId,
          },
        });
        showToast({
          tone: 'success',
          title: 'Route saved',
          description: `${row.doc.label}${scope} now uses the selected series.`,
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the route.');
    }
  }

  const isPending = upsertRoute.isPending || deleteRoute.isPending;
  const rows = buildRoutingRows(series, routes);
  const showNoRoutesNudge = series.length > 0 && routes.length === 0;

  return (
    <section className="numbering-routing" aria-labelledby="numbering-routing-heading">
      <div className="numbering-routing__header">
        <h3 className="section-title" id="numbering-routing-heading">
          Document routing
        </h3>
        <p className="muted-text">
          Choose which series numbers each KSeF document type on this connection. A route can be
          refined by register, currency, and source; the most specific matching route wins.
        </p>
      </div>

      {showNoRoutesNudge ? (
        <Alert tone="info" title="Series created">
          Assign a series to a document type below to start numbering.
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="error" title="Could not update routing">
          {error}
        </Alert>
      ) : null}

      <div className="numbering-routing__table-wrap">
        <table className="numbering-routing__table">
          <thead>
            <tr>
              <th scope="col">Document type</th>
              <th scope="col">Register</th>
              <th scope="col">Currency</th>
              <th scope="col">Source</th>
              <th scope="col">Series</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const route = routes.find(
                (r) =>
                  r.documentType === row.doc.documentType &&
                  routeMatchesAxes(r, row.register, row.currency, row.source),
              );
              const eligible = series.filter(
                (s) => s.documentType === row.doc.documentType && s.register === row.register,
              );
              const currentId = route?.seriesId ?? '';
              // Keep a route that points at a filtered-out series (deleted / re-scoped)
              // visible so the operator can see and change it.
              const currentSeries = series.find((s) => s.id === currentId);
              const options =
                currentSeries && !eligible.some((s) => s.id === currentSeries.id)
                  ? [currentSeries, ...eligible]
                  : eligible;
              const selectId = `numbering-route-${row.key}`;

              return (
                <tr key={row.key} className="numbering-routing__row">
                  <td>
                    <span className="numbering-routing__code mono-text">{row.doc.code}</span>{' '}
                    <span className="numbering-routing__name">{row.doc.label}</span>
                  </td>
                  <td>{axisCell(row.register)}</td>
                  <td>{axisCell(row.currency)}</td>
                  <td>{axisCell(row.source)}</td>
                  <td>
                    {eligible.length === 0 && !currentSeries ? (
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() =>
                          onAddSeries({
                            documentType: row.doc.documentType,
                            register: row.register,
                          })
                        }
                        disabled={readOnly}
                      >
                        Add a series first
                      </button>
                    ) : (
                      <>
                        <label className="sr-only" htmlFor={selectId}>
                          Series for {row.doc.label}
                          {describeScope(row.register, row.currency, row.source)}
                        </label>
                        <Select
                          id={selectId}
                          value={currentId}
                          disabled={readOnly || isPending}
                          onChange={(event) => void applyRoute(row, event.target.value)}
                        >
                          <option value="">Not assigned</option>
                          {options.map((s) => (
                            <option key={s.id} value={s.id}>
                              {seriesOption(s)}
                            </option>
                          ))}
                        </Select>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="numbering-routing__add">
        {showAddForm ? (
          <AddRouteForm
            connectionId={connectionId}
            series={series}
            disabled={readOnly || isPending}
            onClose={() => setShowAddForm(false)}
            onError={setError}
          />
        ) : (
          <Button tone="secondary" onClick={() => setShowAddForm(true)} disabled={readOnly}>
            + Add route
          </Button>
        )}
      </div>

      <ResolutionOrderPanel routes={routes} />
    </section>
  );
}

/** Render one axis cell: the value in mono, or a muted "any" for a wildcard. */
function axisCell(value: string | null): ReactElement {
  return value ? (
    <span className="mono-text">{value}</span>
  ) : (
    <span className="muted-text">{ANY}</span>
  );
}

/** Human scope suffix for toasts / labels, e.g. " (register warehouse-2, EUR, allegro)". */
function describeScope(
  register: string | null,
  currency: string | null,
  source: string | null,
): string {
  const parts: string[] = [];
  if (register) parts.push(`register ${register}`);
  if (currency) parts.push(currency);
  if (source) parts.push(source);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

interface AddRouteFormProps {
  connectionId: string;
  series: NumberingSeries[];
  disabled: boolean;
  onClose: () => void;
  onError: (message: string | null) => void;
}

/**
 * Inline "add route" form — create a route for a document type scoped to an
 * optional register / currency / source. Leaving an axis blank makes it a
 * wildcard (`any`). The series list is filtered to the chosen document type.
 */
function AddRouteForm({
  connectionId,
  series,
  disabled,
  onClose,
  onError,
}: AddRouteFormProps): ReactElement {
  const upsertRoute = useUpsertNumberingRouteMutation();
  const { showToast } = useToast();
  const [documentType, setDocumentType] = useState<DocumentType>(
    KSEF_ROUTED_DOCUMENT_TYPES[0]?.documentType ?? 'invoice',
  );
  const [register, setRegister] = useState('');
  const [currency, setCurrency] = useState('');
  const [source, setSource] = useState('');
  const [seriesId, setSeriesId] = useState('');

  const eligible = useMemo(
    () => series.filter((s) => s.documentType === documentType),
    [series, documentType],
  );

  async function submit(): Promise<void> {
    onError(null);
    if (seriesId === '') {
      onError('Choose a series for the new route.');
      return;
    }
    try {
      await upsertRoute.mutateAsync({
        connectionId,
        input: {
          documentType,
          register: normalizeAxis(register),
          currency: normalizeAxis(currency),
          source: normalizeAxis(source),
          seriesId,
        },
      });
      showToast({ tone: 'success', title: 'Route added', description: 'The routing rule is saved.' });
      onClose();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not add the route.');
    }
  }

  const busy = disabled || upsertRoute.isPending;

  return (
    <div className="numbering-routing__add-form" role="group" aria-label="Add a routing rule">
      <div className="numbering-routing__add-grid">
        <label className="numbering-routing__field">
          <span className="numbering-routing__field-label">Document type</span>
          <Select
            value={documentType}
            disabled={busy}
            onChange={(event) => setDocumentType(event.target.value as DocumentType)}
          >
            {KSEF_ROUTED_DOCUMENT_TYPES.map((doc) => (
              <option key={doc.documentType} value={doc.documentType}>
                {doc.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="numbering-routing__field">
          <span className="numbering-routing__field-label">Register (any)</span>
          <Input
            value={register}
            disabled={busy}
            placeholder="any"
            onChange={(event) => setRegister(event.target.value)}
          />
        </label>
        <label className="numbering-routing__field">
          <span className="numbering-routing__field-label">Currency (any)</span>
          <Input
            value={currency}
            disabled={busy}
            placeholder="any"
            onChange={(event) => setCurrency(event.target.value)}
          />
        </label>
        <label className="numbering-routing__field">
          <span className="numbering-routing__field-label">Source (any)</span>
          <Input
            value={source}
            disabled={busy}
            placeholder="any"
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
        <label className="numbering-routing__field">
          <span className="numbering-routing__field-label">Series</span>
          <Select value={seriesId} disabled={busy} onChange={(event) => setSeriesId(event.target.value)}>
            <option value="">Choose a series…</option>
            {eligible.map((s) => (
              <option key={s.id} value={s.id}>
                {seriesOption(s)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="numbering-routing__add-actions">
        <Button tone="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button tone="primary" onClick={() => void submit()} disabled={busy}>
          {upsertRoute.isPending ? 'Adding…' : 'Add route'}
        </Button>
      </div>
    </div>
  );
}

interface ResolutionOrderPanelProps {
  routes: NumberingRoute[];
}

/** One step of the fallback chain rendered in the resolution panel. */
interface ResolutionStep {
  label: string;
  register: string | null;
  currency: string | null;
  source: string | null;
  matched: NumberingRoute | undefined;
}

/**
 * Resolution-order panel: visualizes the most-specific-match-wins fallback on a
 * live example. Mirrors the backend precedence exactly — exact -> drop source ->
 * drop currency -> drop register (the default). The first step whose route
 * exists is the winner; later steps are shown greyed so the operator sees the
 * whole chain.
 */
function ResolutionOrderPanel({ routes }: ResolutionOrderPanelProps): ReactElement {
  const documentTypes = Array.from(new Set(routes.map((r) => r.documentType)));
  const [documentType, setDocumentType] = useState<string>(
    documentTypes[0] ?? KSEF_ROUTED_DOCUMENT_TYPES[0]?.documentType ?? 'invoice',
  );
  const [register, setRegister] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [source, setSource] = useState('allegro');

  const steps: ResolutionStep[] = useMemo(() => {
    const reg = normalizeAxis(register);
    const cur = normalizeAxis(currency);
    const src = normalizeAxis(source);
    const candidates: Array<{
      label: string;
      register: string | null;
      currency: string | null;
      source: string | null;
    }> = [
      { label: 'Exact', register: reg, currency: cur, source: src },
      { label: 'Drop source', register: reg, currency: cur, source: null },
      { label: 'Drop currency', register: reg, currency: null, source: null },
      { label: 'Default', register: null, currency: null, source: null },
    ];
    return candidates.map((candidate) => ({
      ...candidate,
      matched: routes.find(
        (r) =>
          r.documentType === documentType &&
          routeMatchesAxes(r, candidate.register, candidate.currency, candidate.source),
      ),
    }));
  }, [routes, documentType, register, currency, source]);

  const winnerIndex = steps.findIndex((s) => s.matched !== undefined);

  return (
    <div className="numbering-resolution" aria-labelledby="numbering-resolution-heading">
      <h4 className="numbering-resolution__heading" id="numbering-resolution-heading">
        Resolution order
      </h4>
      <p className="muted-text">
        For an example document, the most specific matching route wins; unmatched axes are dropped in
        order (source, then currency, then register) until a route matches.
      </p>
      <div className="numbering-resolution__inputs">
        <label className="numbering-routing__field">
          <span className="numbering-routing__field-label">Document type</span>
          <Select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
            {KSEF_ROUTED_DOCUMENT_TYPES.map((doc) => (
              <option key={doc.documentType} value={doc.documentType}>
                {doc.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="numbering-routing__field">
          <span className="numbering-routing__field-label">Register</span>
          <Input value={register} placeholder="any" onChange={(event) => setRegister(event.target.value)} />
        </label>
        <label className="numbering-routing__field">
          <span className="numbering-routing__field-label">Currency</span>
          <Input value={currency} placeholder="any" onChange={(event) => setCurrency(event.target.value)} />
        </label>
        <label className="numbering-routing__field">
          <span className="numbering-routing__field-label">Source</span>
          <Input value={source} placeholder="any" onChange={(event) => setSource(event.target.value)} />
        </label>
      </div>
      <ol className="numbering-resolution__steps">
        {steps.map((step, index) => {
          const isWinner = index === winnerIndex;
          const isDropped = winnerIndex !== -1 && index > winnerIndex;
          const className = [
            'numbering-resolution__step',
            isWinner ? 'numbering-resolution__step--winner' : '',
            isDropped ? 'numbering-resolution__step--dropped' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={step.label} className={className}>
              <span className="numbering-resolution__step-label">{step.label}</span>
              <span className="numbering-resolution__step-key mono-text">
                register={step.register ?? ANY}, currency={step.currency ?? ANY}, source=
                {step.source ?? ANY}
              </span>
              <span className="numbering-resolution__step-result">
                {step.matched ? (isWinner ? 'matches ✓' : 'matches') : 'no route'}
              </span>
            </li>
          );
        })}
      </ol>
      {winnerIndex === -1 ? (
        <p className="muted-text numbering-resolution__none">
          No route matches this example — issuing would fail with "no numbering series". Add a
          default route for this document type.
        </p>
      ) : null}
    </div>
  );
}
