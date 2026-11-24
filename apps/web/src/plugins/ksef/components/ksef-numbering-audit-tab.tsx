/**
 * KSeF numbering - Number audit tab
 *
 * A read model of a series' allocated-vs-issued sequence, with gap rows
 * highlighted. For an unexplained gap the operator can record a written
 * explanation (the PL "oświadczenie o pominięciu numeru"); an explained gap
 * shows its recorded note. From either state the operator can open a printable
 * oświadczenie document (#1695). Turns a silent numbering-gap liability into a
 * manageable, documented one.
 *
 * @module plugins/ksef/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useConnectionQuery } from '../../../features/connections';
import {
  useNumberingSeriesListQuery,
  useRecordGapNoteMutation,
  useSeriesAuditQuery,
  type NumberingSeries,
  type SeriesAuditEntry,
} from '../../../features/invoicing';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { Select } from '../../../shared/ui/select';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Textarea } from '../../../shared/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useToast } from '../../../shared/ui/toast-provider';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { interpolate, renderRich, useFormat } from '../../../shared/i18n';
import { useKsefMessages } from '../messages';
import { SEQ_STATUS_LABELS, SEQ_STATUS_TONES } from './ksef-numbering.lib';
import { KsefOswiadczenieDocument } from './ksef-oswiadczenie-document';
import { readKsefSellerProfile, type KsefOswiadczenieContent } from '../lib/ksef-oswiadczenie';
import { describeApiError } from '../../../shared/api/describe-api-error';

interface KsefNumberingAuditTabProps {
  connectionId: string;
  readOnly: boolean;
}

/** Assemble the oświadczenie content from the selected series, a gap entry, and the reason. */
function buildOswiadczenieContent(
  series: NumberingSeries | undefined,
  entry: SeriesAuditEntry,
  reason: string,
  sellerConfig: Record<string, unknown>,
): KsefOswiadczenieContent {
  return {
    seller: readKsefSellerProfile(sellerConfig),
    seriesName: series?.name ?? '',
    seriesPattern: series?.pattern ?? '',
    skippedNumber: entry.documentNumber ?? String(entry.seq),
    reason,
  };
}

export function KsefNumberingAuditTab({
  connectionId,
  readOnly,
}: KsefNumberingAuditTabProps): ReactElement {
  const copy = useKsefMessages().ksefNumberingAuditTab;
  const format = useFormat();
  const seriesQuery = useNumberingSeriesListQuery();
  const connectionQuery = useConnectionQuery(connectionId);
  const [seriesId, setSeriesId] = useState<string>('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [gapTarget, setGapTarget] = useState<SeriesAuditEntry | null>(null);
  const [printContent, setPrintContent] = useState<KsefOswiadczenieContent | null>(null);

  const auditQuery = useSeriesAuditQuery(seriesId || null, { onlyGaps });

  // Default the picker to the first series once the list resolves.
  useEffect(() => {
    if (seriesId === '' && seriesQuery.data && seriesQuery.data.length > 0) {
      setSeriesId(seriesQuery.data[0].id);
    }
  }, [seriesId, seriesQuery.data]);

  if (seriesQuery.isLoading) {
    return <LoadingState title={copy.loadingSeries.title} message={copy.loadingSeries.message} />;
  }
  const series = seriesQuery.data ?? [];
  if (series.length === 0) {
    return (
      <EmptyState
        title={copy.empty.title}
        message={copy.empty.message}
      />
    );
  }

  const audit = auditQuery.data;
  const selectedSeries = series.find((s) => s.id === seriesId);
  const sellerConfig = connectionQuery.data?.config ?? {};

  function openPrint(entry: SeriesAuditEntry, reason: string): void {
    setPrintContent(buildOswiadczenieContent(selectedSeries, entry, reason, sellerConfig));
  }

  return (
    <div className="numbering-audit">
      <div className="numbering-audit__toolbar">
        <div className="numbering-audit__picker">
          <label className="sr-only" htmlFor="numbering-audit-series">
            {copy.seriesPickerLabel}
          </label>
          <Select
            id="numbering-audit-series"
            value={seriesId}
            onChange={(event) => setSeriesId(event.target.value)}
          >
            {series.map((s) => (
              <option key={s.id} value={s.id}>
                {interpolate(copy.seriesOption, { name: s.name, pattern: s.pattern })}
              </option>
            ))}
          </Select>
        </div>
        <label className="numbering-audit__gaps-toggle">
          <input
            type="checkbox"
            checked={onlyGaps}
            onChange={(event) => setOnlyGaps(event.target.checked)}
          />
          <span>{copy.onlyGaps}</span>
        </label>
      </div>

      {auditQuery.isLoading ? (
        <LoadingState title={copy.loadingAudit.title} message={copy.loadingAudit.message} />
      ) : auditQuery.error ? (
        <ErrorState
          title={copy.loadError}
          message={describeApiError(auditQuery.error, 'ksef')}
          action={
            <Button tone="secondary" onClick={() => void auditQuery.refetch()}>
              {copy.retry}
            </Button>
          }
        />
      ) : audit ? (
        <>
          <p className="numbering-audit__summary">
            {renderRich(
              copy.summary,
              { num: (text) => <span className="mono-text tabular">{text}</span> },
              {
                issued: format.number(audit.summary.issuedCount),
                gaps: format.number(audit.summary.gapCount),
                explained: format.number(audit.summary.explainedGapCount),
                abandoned: format.number(audit.summary.abandonedCount),
                skipped: format.number(audit.summary.skippedCount),
                pending: format.number(audit.summary.pendingCount),
              },
            )}
          </p>

          {audit.entries.length === 0 ? (
            <EmptyState
              title={onlyGaps ? copy.noGaps.title : copy.noEntries.title}
              message={onlyGaps ? copy.noGaps.message : copy.noEntries.message}
            />
          ) : (
            <div className="numbering-table-wrap">
              <table className="numbering-table numbering-audit__table">
                <thead>
                  <tr>
                    <th scope="col">{copy.columns.seq}</th>
                    <th scope="col">{copy.columns.number}</th>
                    <th scope="col">{copy.columns.status}</th>
                    <th scope="col">{copy.columns.explanation}</th>
                    <th scope="col">
                      <span className="sr-only">{copy.columns.actions}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {audit.entries.map((entry) => (
                    <tr
                      key={entry.seq}
                      className={entry.isGap ? 'numbering-audit__row--gap' : undefined}
                    >
                      <td className="mono-text tabular">{entry.seq}</td>
                      <td className="mono-text tabular">
                        {entry.documentNumber ?? <span className="muted-text">—</span>}
                      </td>
                      <td>
                        <StatusBadge tone={SEQ_STATUS_TONES[entry.status]} compact withDot>
                          {SEQ_STATUS_LABELS[entry.status]}
                        </StatusBadge>
                      </td>
                      <td>
                        {entry.note ? (
                          <span className="numbering-audit__note">{entry.note.reason}</span>
                        ) : entry.isGap ? (
                          <span className="muted-text">{copy.notExplained}</span>
                        ) : (
                          <span className="muted-text">—</span>
                        )}
                      </td>
                      <td className="numbering-table__actions">
                        {entry.isGap && !entry.note ? (
                          <ReadOnlyLock active={readOnly} message={demoReadOnlyActionMessage()}>
                            <Button
                              tone="secondary"
                              onClick={() => setGapTarget(entry)}
                              disabled={readOnly}
                            >
                              {copy.explainGap}
                            </Button>
                          </ReadOnlyLock>
                        ) : entry.isGap && entry.note ? (
                          <Button
                            tone="secondary"
                            onClick={() => openPrint(entry, entry.note?.reason ?? '')}
                          >
                            {copy.printOswiadczenie}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {gapTarget ? (
        <ExplainGapDialog
          seriesId={seriesId}
          entry={gapTarget}
          readOnly={readOnly}
          onClose={() => setGapTarget(null)}
          onSaveAndPrint={(entry, reason) => {
            setGapTarget(null);
            openPrint(entry, reason);
          }}
        />
      ) : null}

      {printContent ? (
        <KsefOswiadczenieDocument content={printContent} onClose={() => setPrintContent(null)} />
      ) : null}
    </div>
  );
}

interface ExplainGapDialogProps {
  seriesId: string;
  entry: SeriesAuditEntry;
  readOnly: boolean;
  onClose: () => void;
  onSaveAndPrint: (entry: SeriesAuditEntry, reason: string) => void;
}

function ExplainGapDialog({
  seriesId,
  entry,
  readOnly,
  onClose,
  onSaveAndPrint,
}: ExplainGapDialogProps): ReactElement {
  const copy = useKsefMessages().ksefNumberingAuditTab.dialog;
  const recordNote = useRecordGapNoteMutation();
  const { showToast } = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Record the note; returns the trimmed reason on success, null on failure so
  // the caller can decide whether to also open the print view.
  async function record(): Promise<string | null> {
    setError(null);
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setError(copy.reasonRequired);
      textareaRef.current?.focus();
      return null;
    }
    try {
      await recordNote.mutateAsync({
        seriesId,
        input: { seq: entry.seq, documentNumber: entry.documentNumber, reason: trimmed },
      });
      return trimmed;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.recordFallback);
      return null;
    }
  }

  async function submit(): Promise<void> {
    const recorded = await record();
    if (recorded === null) return;
    showToast({
      tone: 'success',
      title: copy.toast.title,
      description: interpolate(copy.toast.description, { seq: entry.seq }),
    });
    onClose();
  }

  async function saveAndPrint(): Promise<void> {
    const recorded = await record();
    if (recorded === null) return;
    showToast({
      tone: 'success',
      title: copy.toast.title,
      description: interpolate(copy.toast.description, { seq: entry.seq }),
    });
    onSaveAndPrint(entry, recorded);
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textareaRef.current?.focus();
        }}
      >
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>
          {renderRich(
            copy.description,
            { num: (text) => <span className="mono-text tabular">{text}</span> },
            { seq: entry.seq },
          )}
        </DialogDescription>

        {error ? (
          <Alert tone="error" title={copy.errorTitle}>
            {error}
          </Alert>
        ) : null}

        <label className="form-field__label" htmlFor="numbering-gap-reason">
          {copy.reasonLabel}
        </label>
        <Textarea
          id="numbering-gap-reason"
          ref={textareaRef}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
          placeholder={copy.reasonPlaceholder}
        />

        <DialogFooter>
          <Button tone="secondary" onClick={onClose} disabled={recordNote.isPending}>
            {copy.cancel}
          </Button>
          <Button
            tone="secondary"
            onClick={() => void submit()}
            disabled={recordNote.isPending || readOnly}
          >
            {recordNote.isPending ? copy.saving : copy.record}
          </Button>
          <Button
            tone="primary"
            onClick={() => void saveAndPrint()}
            disabled={recordNote.isPending || readOnly}
          >
            {copy.saveAndPrint}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
