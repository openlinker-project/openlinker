/**
 * KSeF numbering — document routing card
 *
 * Maps each KSeF FA(3) document variant (VAT / KOR / ZAL / …) to the numbering
 * series that supplies its number, on the register-less default route. Backed by
 * the numbering-routes endpoints: choosing a series upserts the route, choosing
 * "Not assigned" detaches it (the series survives). A document type with no
 * matching series shows an "Add a series first" affordance instead of an empty
 * picker.
 *
 * @module plugins/ksef/components
 */
import { useState, type ReactElement } from 'react';
import {
  useDeleteNumberingRouteMutation,
  useUpsertNumberingRouteMutation,
  type NumberingRoute,
  type NumberingSeries,
} from '../../../features/invoicing';
import { Alert } from '../../../shared/ui/alert';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import { KSEF_ROUTED_DOCUMENT_TYPES, type KsefRoutedDocumentType } from './ksef-numbering.lib';

interface KsefNumberingRoutingCardProps {
  connectionId: string;
  series: NumberingSeries[];
  routes: NumberingRoute[];
  readOnly: boolean;
  onAddSeries: () => void;
}

function seriesOption(series: NumberingSeries): string {
  return `${series.name} — ${series.pattern}`;
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

  async function applyRoute(row: KsefRoutedDocumentType, seriesId: string): Promise<void> {
    setError(null);
    try {
      if (seriesId === '') {
        await deleteRoute.mutateAsync({ connectionId, input: { documentType: row.documentType } });
        showToast({ tone: 'success', title: 'Route removed', description: `${row.label} is no longer routed.` });
      } else {
        await upsertRoute.mutateAsync({
          connectionId,
          input: { documentType: row.documentType, seriesId },
        });
        showToast({ tone: 'success', title: 'Route saved', description: `${row.label} now uses the selected series.` });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the route.');
    }
  }

  const isPending = upsertRoute.isPending || deleteRoute.isPending;

  return (
    <section className="numbering-routing" aria-labelledby="numbering-routing-heading">
      <div className="numbering-routing__header">
        <h3 className="section-title" id="numbering-routing-heading">
          Document routing
        </h3>
        <p className="muted-text">Choose which series numbers each KSeF document type.</p>
      </div>

      {error ? (
        <Alert tone="error" title="Could not update routing">
          {error}
        </Alert>
      ) : null}

      <ul className="numbering-routing__list">
        {KSEF_ROUTED_DOCUMENT_TYPES.map((row) => {
          const route = routes.find(
            (r) => r.documentType === row.documentType && r.register === null,
          );
          const eligible = series.filter((s) => s.documentType === row.documentType);
          const currentId = route?.seriesId ?? '';
          // If the current route points to a series filtered out (e.g. register-scoped),
          // keep it visible so the operator can see and change it.
          const currentSeries = series.find((s) => s.id === currentId);
          const options =
            currentSeries && !eligible.some((s) => s.id === currentSeries.id)
              ? [currentSeries, ...eligible]
              : eligible;
          const selectId = `numbering-route-${row.documentType}`;

          return (
            <li key={row.documentType} className="numbering-routing__row">
              <div className="numbering-routing__label">
                <span className="numbering-routing__code mono-text">{row.code}</span>
                <span className="numbering-routing__name">{row.label}</span>
                <span className="muted-text numbering-routing__hint">{row.hint}</span>
              </div>
              {eligible.length === 0 && !currentSeries ? (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={onAddSeries}
                  disabled={readOnly}
                >
                  Add a series first
                </button>
              ) : (
                <label className="sr-only" htmlFor={selectId}>
                  Series for {row.label}
                </label>
              )}
              {eligible.length > 0 || currentSeries ? (
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
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
