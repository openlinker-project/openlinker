/**
 * KSeF numbering — Series tab
 *
 * The Series tab of the numbering page: a table of numbering series (with a
 * register/scope filter and an "Add series" action), plus the document-routing
 * card mapping each KSeF document type to a series. Owns the inline editor mode
 * (list ↔ create ↔ edit) and moves focus to the new surface heading on each
 * transition so keyboard / SR users are never dropped at the top of the page.
 *
 * @module plugins/ksef/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  renderInvoiceNumber,
  useNumberingRoutesQuery,
  useNumberingSeriesListQuery,
  type NumberingSeries,
} from '../../../features/invoicing';
import { Button } from '../../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { Select } from '../../../shared/ui/select';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { KsefNumberingEditor } from './ksef-numbering-editor';
import { KsefNumberingRoutingCard, type RoutingSeriesPrefill } from './ksef-numbering-routing-card';
import { KSEF_TIME_ZONE, documentTypeLabel, RESET_POLICY_LABELS } from './ksef-numbering.lib';

interface KsefNumberingSeriesTabProps {
  connectionId: string;
  readOnly: boolean;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'create'; prefill?: RoutingSeriesPrefill }
  | { kind: 'edit'; series: NumberingSeries };

const ALL_REGISTERS = '__all__';
const DEFAULT_REGISTER = '__default__';

function nextNumber(series: NumberingSeries): string {
  return renderInvoiceNumber(series.pattern, {
    seq: series.nextSeq,
    seqPadding: series.seqPadding,
    issueDate: new Date(),
    timeZone: KSEF_TIME_ZONE,
  });
}

export function KsefNumberingSeriesTab({
  connectionId,
  readOnly,
}: KsefNumberingSeriesTabProps): ReactElement {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [registerFilter, setRegisterFilter] = useState<string>(ALL_REGISTERS);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const returningRef = useRef(false);

  const seriesQuery = useNumberingSeriesListQuery();
  const routesQuery = useNumberingRoutesQuery(connectionId);

  // When returning from the editor to the list, move focus to the Series heading.
  useEffect(() => {
    if (mode.kind === 'list' && returningRef.current) {
      returningRef.current = false;
      headingRef.current?.focus();
    }
  }, [mode]);

  function backToList(): void {
    returningRef.current = true;
    setMode({ kind: 'list' });
  }

  if (mode.kind === 'create' || mode.kind === 'edit') {
    return (
      <KsefNumberingEditor
        connectionId={connectionId}
        series={mode.kind === 'edit' ? mode.series : undefined}
        createPrefill={mode.kind === 'create' ? mode.prefill : undefined}
        onDone={backToList}
        onCancel={backToList}
      />
    );
  }

  if (seriesQuery.isLoading || routesQuery.isLoading) {
    return <LoadingState title="Loading series" message="Fetching this connection's numbering setup…" />;
  }
  if (seriesQuery.error) {
    return (
      <ErrorState
        title="Unable to load numbering series"
        message={seriesQuery.error.message}
        action={
          <Button tone="secondary" onClick={() => void seriesQuery.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const series = seriesQuery.data ?? [];
  const routes = routesQuery.data ?? [];

  const registerValues = Array.from(
    new Set(series.map((s) => s.register).filter((r): r is string => r !== null)),
  ).sort();

  const filtered = series.filter((s) => {
    if (registerFilter === ALL_REGISTERS) return true;
    if (registerFilter === DEFAULT_REGISTER) return s.register === null;
    return s.register === registerFilter;
  });

  if (series.length === 0) {
    return (
      <div className="numbering-series-tab">
        <div className="numbering-empty-glyph" aria-hidden="true">
          №
        </div>
        <EmptyState
          title="No numbering series yet"
          message="Create a series before issuing invoices — KSeF needs a unique, sequential number for every document."
          action={
            <Button tone="primary" onClick={() => setMode({ kind: 'create' })} disabled={readOnly}>
              Add series
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="numbering-series-tab">
      <div className="numbering-series-tab__toolbar">
        <div className="numbering-series-tab__heading">
          <h3 className="section-title" ref={headingRef} tabIndex={-1}>
            Series
          </h3>
          <p className="muted-text numbering-series-tab__subtitle">
            Shared across every connection; routing below is per-connection.
          </p>
        </div>
        <div className="numbering-series-tab__toolbar-actions">
          {registerValues.length > 0 ? (
            <>
              <label className="sr-only" htmlFor="numbering-register-filter">
                Filter by register
              </label>
              <Select
                id="numbering-register-filter"
                value={registerFilter}
                onChange={(event) => setRegisterFilter(event.target.value)}
              >
                <option value={ALL_REGISTERS}>All registers</option>
                <option value={DEFAULT_REGISTER}>Default (no register)</option>
                {registerValues.map((register) => (
                  <option key={register} value={register}>
                    {register}
                  </option>
                ))}
              </Select>
            </>
          ) : null}
          <Button tone="primary" onClick={() => setMode({ kind: 'create' })} disabled={readOnly}>
            Add series
          </Button>
        </div>
      </div>

      <div className="numbering-table-wrap">
        <table className="numbering-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Pattern</th>
              <th scope="col">Document type</th>
              <th scope="col">Register</th>
              <th scope="col">Next</th>
              <th scope="col">Reset</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>
                  <span className="numbering-table__pattern mono-text">{s.pattern}</span>
                </td>
                <td>
                  <StatusBadge tone="neutral" compact>
                    {documentTypeLabel(s.documentType)}
                  </StatusBadge>
                </td>
                <td>{s.register ?? <span className="muted-text">—</span>}</td>
                <td className="mono-text tabular">{nextNumber(s)}</td>
                <td>{RESET_POLICY_LABELS[s.resetPolicy]}</td>
                <td className="numbering-table__actions">
                  <Button tone="secondary" onClick={() => setMode({ kind: 'edit', series: s })} disabled={readOnly}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="numbering-table__empty muted-text">
                  No series in this register.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <KsefNumberingRoutingCard
        connectionId={connectionId}
        series={series}
        routes={routes}
        readOnly={readOnly}
        onAddSeries={(prefill) => setMode({ kind: 'create', prefill })}
      />
    </div>
  );
}
