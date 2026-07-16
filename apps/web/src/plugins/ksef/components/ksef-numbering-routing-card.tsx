/**
 * KSeF numbering — document routing card
 *
 * Maps each KSeF FA(3) document variant (VAT / KOR / ZAL / …) to the numbering
 * series that supplies its number. Routing is per-connection and register-aware:
 * a row exists per `(documentType, register)`, where the default (register-less)
 * row is always shown and an extra row appears for every register present among
 * the series (or existing routes) of that document type. Backed by the
 * numbering-routes endpoints: choosing a series upserts the route for that
 * `(documentType, register)`, choosing "Not assigned" detaches it (the series
 * survives). A row with no matching series shows an "Add a series first"
 * affordance that opens the editor prefilled with that document type + register.
 *
 * @module plugins/ksef/components
 */
import { useState, type ReactElement } from 'react';
import {
  useDeleteNumberingRouteMutation,
  useUpsertNumberingRouteMutation,
  type DocumentType,
  type NumberingRoute,
  type NumberingSeries,
} from '../../../features/invoicing';
import { Alert } from '../../../shared/ui/alert';
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

/** One rendered routing row: a document type scoped to an optional register. */
interface RoutingRow {
  key: string;
  doc: KsefRoutedDocumentType;
  register: string | null;
}

function seriesOption(series: NumberingSeries): string {
  return `${series.name} — ${series.pattern}`;
}

/**
 * Enumerate the routing rows: the default (register-less) row for every document
 * type, plus one extra row per register that appears among that type's series or
 * existing routes, so a register-scoped series/route can always be seen and
 * changed here rather than being silently unreachable.
 */
function buildRoutingRows(series: NumberingSeries[], routes: NumberingRoute[]): RoutingRow[] {
  const rows: RoutingRow[] = [];
  for (const doc of KSEF_ROUTED_DOCUMENT_TYPES) {
    const registers = new Set<string>();
    for (const s of series) {
      if (s.documentType === doc.documentType && s.register !== null) registers.add(s.register);
    }
    for (const r of routes) {
      if (r.documentType === doc.documentType && r.register !== null) registers.add(r.register);
    }
    rows.push({ key: `${doc.documentType}::`, doc, register: null });
    for (const register of Array.from(registers).sort()) {
      rows.push({ key: `${doc.documentType}::${register}`, doc, register });
    }
  }
  return rows;
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

  async function applyRoute(row: RoutingRow, seriesId: string): Promise<void> {
    setError(null);
    const scope = row.register ? ` (${row.register})` : '';
    try {
      if (seriesId === '') {
        await deleteRoute.mutateAsync({
          connectionId,
          input: { documentType: row.doc.documentType, register: row.register },
        });
        showToast({
          tone: 'success',
          title: 'Route removed',
          description: `${row.doc.label}${scope} is no longer routed.`,
        });
      } else {
        await upsertRoute.mutateAsync({
          connectionId,
          input: { documentType: row.doc.documentType, register: row.register, seriesId },
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
          Choose which series numbers each KSeF document type on this connection.
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

      <ul className="numbering-routing__list">
        {rows.map((row) => {
          const route = routes.find(
            (r) => r.documentType === row.doc.documentType && r.register === row.register,
          );
          const eligible = series.filter(
            (s) => s.documentType === row.doc.documentType && s.register === row.register,
          );
          const currentId = route?.seriesId ?? '';
          // If the current route points to a series filtered out (e.g. deleted or
          // re-scoped), keep it visible so the operator can see and change it.
          const currentSeries = series.find((s) => s.id === currentId);
          const options =
            currentSeries && !eligible.some((s) => s.id === currentSeries.id)
              ? [currentSeries, ...eligible]
              : eligible;
          const selectId = `numbering-route-${row.key}`;
          const scopeLabel = row.register ? `${row.doc.label} (${row.register})` : row.doc.label;

          return (
            <li key={row.key} className="numbering-routing__row">
              <div className="numbering-routing__label">
                <span className="numbering-routing__code mono-text">{row.doc.code}</span>
                <span className="numbering-routing__name">
                  {row.doc.label}
                  {row.register ? (
                    <span className="numbering-routing__scope mono-text">{row.register}</span>
                  ) : null}
                </span>
                <span className="muted-text numbering-routing__hint">{row.doc.hint}</span>
              </div>
              {eligible.length === 0 && !currentSeries ? (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() =>
                    onAddSeries({ documentType: row.doc.documentType, register: row.register })
                  }
                  disabled={readOnly}
                >
                  Add a series first
                </button>
              ) : (
                <>
                  <label className="sr-only" htmlFor={selectId}>
                    Series for {scopeLabel}
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
