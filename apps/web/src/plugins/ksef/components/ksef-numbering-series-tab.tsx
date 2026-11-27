/**
 * KSeF numbering - Series tab
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
import { captureDemoEvent } from '../../../features/demo';
import { useKsefMessages } from '../messages';
import { describeApiError } from '../../../shared/api/describe-api-error';

interface KsefNumberingSeriesTabProps {
  connectionId: string;
  readOnly: boolean;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'create'; prefill?: RoutingSeriesPrefill }
  | { kind: 'edit'; series: NumberingSeries };

/** Decorative numero sign on the empty state; not text an operator reads. */
const NUMERO_GLYPH = '№';
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
  const copy = useKsefMessages().ksefNumberingSeriesTab;
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [registerFilter, setRegisterFilter] = useState<string>(ALL_REGISTERS);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const returningRef = useRef(false);

  const seriesQuery = useNumberingSeriesListQuery();
  const routesQuery = useNumberingRoutesQuery(connectionId);

  function openCreate(): void {
    captureDemoEvent('demo_ksef_series_editor_opened', { mode: 'create' });
    setMode({ kind: 'create' });
  }

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
        readOnly={readOnly}
        onDone={backToList}
        onCancel={backToList}
      />
    );
  }

  if (seriesQuery.isLoading || routesQuery.isLoading) {
    return <LoadingState title={copy.loading.title} message={copy.loading.message} />;
  }
  if (seriesQuery.error) {
    return (
      <ErrorState
        title={copy.loadError}
        message={describeApiError(seriesQuery.error, 'ksef')}
        action={
          <Button tone="secondary" onClick={() => void seriesQuery.refetch()}>
            {copy.retry}
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
          {NUMERO_GLYPH}
        </div>
        <EmptyState
          title={copy.empty.title}
          message={copy.empty.message}
          action={
            <Button tone="primary" onClick={openCreate}>
              {copy.addSeries}
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
            {copy.heading}
          </h3>
          <p className="muted-text numbering-series-tab__subtitle">{copy.subtitle}</p>
        </div>
        <div className="numbering-series-tab__toolbar-actions">
          {registerValues.length > 0 ? (
            <>
              <label className="sr-only" htmlFor="numbering-register-filter">
                {copy.registerFilter.label}
              </label>
              <Select
                id="numbering-register-filter"
                value={registerFilter}
                onChange={(event) => setRegisterFilter(event.target.value)}
              >
                <option value={ALL_REGISTERS}>{copy.registerFilter.all}</option>
                <option value={DEFAULT_REGISTER}>{copy.registerFilter.default}</option>
                {registerValues.map((register) => (
                  <option key={register} value={register}>
                    {register}
                  </option>
                ))}
              </Select>
            </>
          ) : null}
          <Button tone="primary" onClick={openCreate}>
            {copy.addSeries}
          </Button>
        </div>
      </div>

      <div className="numbering-table-wrap">
        <table className="numbering-table">
          <thead>
            <tr>
              <th scope="col">{copy.columns.name}</th>
              <th scope="col">{copy.columns.pattern}</th>
              <th scope="col">{copy.columns.documentType}</th>
              <th scope="col">{copy.columns.register}</th>
              <th scope="col">{copy.columns.next}</th>
              <th scope="col">{copy.columns.reset}</th>
              <th scope="col">
                <span className="sr-only">{copy.columns.actions}</span>
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
                  <Button
                    tone="secondary"
                    onClick={() => {
                      captureDemoEvent('demo_ksef_series_editor_opened', { mode: 'edit' });
                      setMode({ kind: 'edit', series: s });
                    }}
                  >
                    {copy.edit}
                  </Button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="numbering-table__empty muted-text">
                  {copy.noSeriesInRegister}
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
