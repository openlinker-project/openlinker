/**
 * Sales Documents Panel (#2159, ADR-041 mockup tab 02 "Configuration")
 *
 * The ONLY editable surface for sales-document routing config. Lists every
 * connection with `Invoicing` or `Fiscalization` enabled and lets an operator
 * set, per row: what it issues (Issues), whether it is the one that auto-
 * issues (Primary — a SINGLE radio group across ALL rows, so the UI cannot
 * express two primaries by construction), and when (Trigger, disabled for a
 * non-primary row since timing is meaningless until a connection is actually
 * the one issuing). Trigger is per document kind (#3582): a `'both'` row gets
 * one control for invoices and one for receipts, each showing the value the
 * gate will enforce (kind-scoped, else the legacy key, else manual).
 *
 * `EditConnectionForm`'s per-connection section was demoted to a read-only
 * summary + a link here — see `sales-document-status-section.tsx`. This is
 * deliberate, not an oversight: an earlier mockup draft kept a per-connection
 * editable checkbox and was rejected in review, because "primary" can only be
 * set correctly by seeing every candidate at once (N independent checkboxes
 * across N connection forms is exactly the shape that produces a conflict).
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { useState, type ChangeEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../../shared/ui/alert';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { ConnectionStatus } from '../../connections';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { useDocumentProvidersQuery } from '../../gift-documents';
import { INVOICE_TRIGGER_MODEL_VALUES, INVOICE_TRIGGER_MODEL_LABELS } from '../../connections';
import { useSalesDocumentRows } from '../hooks/use-sales-document-rows';
import { useUpdateSalesDocumentMutation } from '../hooks/use-update-sales-document-mutation';
import { detectSalesDocumentConflict } from '../lib/detect-sales-document-conflict';
import { issuedDocumentKinds } from '../lib/derive-sales-document-rows';
import { batchScreenPath } from '../lib/batch-screen-path';
import {
  getSalesDocumentIssuesOptions,
  type ConcreteDocumentKind,
  type SalesDocumentKind,
  type SalesDocumentRow,
} from '../api/sales-documents.types';
import { interpolate, useMessages } from '../../../shared/i18n';
import { describeApiError } from '../../../shared/api/describe-api-error';

// Mirrors `apps/web/src/pages/connections/connections-list-page.tsx`'s own
// `toStatusTone` — kept as a small duplicate rather than a shared export,
// since this feature must not import from `pages/` (dependency direction:
// app -> pages -> features -> shared).
function toStatusTone(status: ConnectionStatus): StatusBadgeTone {
  switch (status) {
    case 'active':
      return 'success';
    case 'disabled':
      return 'neutral';
    case 'error':
      return 'error';
    case 'needs_reauth':
      return 'warning';
    case 'archived':
      return 'neutral';
  }
}

function ZeroLineBadge({ support }: { support: boolean | null | undefined }): ReactElement {
  const copy = useMessages('sales-documents').salesDocumentsPanel.zeroLine;
  if (support === true) {
    return (
      <StatusBadge tone="success" compact>
        {copy.accepts}
      </StatusBadge>
    );
  }
  if (support === false) {
    return (
      <StatusBadge tone="warning" compact>
        {copy.refuses}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="neutral" compact>
      {copy.unknown}
    </StatusBadge>
  );
}

const CONFLICT_KEY = {
  'multiple-primaries': 'multiplePrimaries',
  'ambiguous-no-primary': 'ambiguousNoPrimary',
} as const;

export function SalesDocumentsPanel(): ReactElement {
  const copy = useMessages('sales-documents').salesDocumentsPanel;
  const { connectionsQuery, rows } = useSalesDocumentRows();
  const statusLabels: Record<string, string> = copy.status;
  const capabilityLabels: Record<string, string> = copy.capability;
  const { updateField, isPending } = useUpdateSalesDocumentMutation();
  const [pendingConnectionId, setPendingConnectionId] = useState<string | null>(null);

  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  // Enrichment only: while it loads or fails the column reads "no declaration".
  const providersQuery = useDocumentProvidersQuery();
  const zeroSupportFor = (connectionId: string): boolean | null | undefined =>
    providersQuery.data?.providers.find((p) => p.connectionId === connectionId)?.acceptsZeroValueLine;

  if (connectionsQuery.isLoading) {
    return (
      <LoadingState
        title={copy.loading.title}
        message={copy.loading.message}
      />
    );
  }

  if (connectionsQuery.error) {
    return (
      <ErrorState
        title={copy.loadError}
        message={describeApiError(connectionsQuery.error, 'sales-documents')}
        action={<Button onClick={() => void connectionsQuery.refetch()}>{copy.retry}</Button>}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <Alert tone="info" title={copy.empty.title}>
        {copy.empty.message}
      </Alert>
    );
  }

  const conflict = detectSalesDocumentConflict(rows);

  async function runRowUpdate(connectionId: string, run: () => Promise<void>): Promise<void> {
    setPendingConnectionId(connectionId);
    try {
      await run();
    } finally {
      setPendingConnectionId(null);
    }
  }

  function handleIssuesChange(row: SalesDocumentRow, event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    void runRowUpdate(row.connectionId, () =>
      updateField({
        connectionId: row.connectionId,
        patch: { documentKind: value as SalesDocumentKind | '' },
      }),
    );
  }

  function handleTriggerChange(
    row: SalesDocumentRow,
    kind: ConcreteDocumentKind,
    event: ChangeEvent<HTMLSelectElement>,
  ): void {
    const value = event.target.value;
    void runRowUpdate(row.connectionId, () =>
      updateField({ connectionId: row.connectionId, patch: { triggerModel: { kind, value } } }),
    );
  }

  function renderTriggerSelect(
    row: SalesDocumentRow,
    kind: ConcreteDocumentKind | null,
    disabled: boolean,
    showKindLabel: boolean,
  ): ReactElement {
    const kindLabel = kind === null ? null : copy.triggerKind[kind];
    const select = (
      <Select
        aria-label={
          kind === null
            ? interpolate(copy.triggerLabel, { name: row.name })
            : interpolate(copy.triggerKindLabel[kind], { name: row.name })
        }
        // A row issuing nothing has no kind to read; it shows the invoice value
        // only as a placeholder, disabled.
        value={row.triggerModels[kind ?? 'invoice']}
        disabled={disabled || kind === null}
        onChange={(event) => {
          if (kind !== null) handleTriggerChange(row, kind, event);
        }}
      >
        {INVOICE_TRIGGER_MODEL_VALUES.map((value) => (
          <option key={value} value={value}>
            {INVOICE_TRIGGER_MODEL_LABELS[value]}
          </option>
        ))}
      </Select>
    );
    return (
      <ReadOnlyLock
        key={kind ?? 'none'}
        active={write.demoReadOnly}
        message={demoReadOnlyActionMessage()}
      >
        {showKindLabel && kindLabel !== null ? (
          <div className="sales-documents-panel__trigger">
            <span className="muted-text">{kindLabel}</span>
            {select}
          </div>
        ) : (
          select
        )}
      </ReadOnlyLock>
    );
  }

  function handleSelectPrimary(row: SalesDocumentRow): void {
    if (row.isPrimary) return;
    // Clear every OTHER row currently marked primary, not just one — this also
    // lets picking a new primary self-heal a pre-existing multi-primary
    // conflict, not merely avoid creating a new one.
    const othersToClear = rows.filter((r) => r.isPrimary && r.connectionId !== row.connectionId);
    void runRowUpdate(row.connectionId, async () => {
      await updateField({ connectionId: row.connectionId, patch: { isPrimary: true } });
      for (const other of othersToClear) {
        await updateField({ connectionId: other.connectionId, patch: { isPrimary: false } });
      }
    });
  }

  return (
    <div className="page-section" style={{ marginTop: 'var(--space-6)' }}>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <h3 className="detail-section__title">{copy.title}</h3>
      </header>

      {conflict ? (
        <Alert tone="error" title={copy.conflict[CONFLICT_KEY[conflict]].title}>
          {copy.conflict[CONFLICT_KEY[conflict]].body}
        </Alert>
      ) : null}

      <p className="muted-text">
        {copy.intro}
      </p>

      <div className="data-table__container">
        <table className="data-table" aria-label={copy.table.label}>
          <caption className="sr-only">
            {copy.table.caption}
          </caption>
          <thead>
            <tr>
              <th scope="col">{copy.table.provider}</th>
              <th scope="col">{copy.table.status}</th>
              <th scope="col">{copy.table.capability}</th>
              <th scope="col">{copy.table.issues}</th>
              <th scope="col">{copy.table.primary}</th>
              <th scope="col">{copy.table.trigger}</th>
              <th scope="col">{copy.table.zeroLine}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowPending = isPending && pendingConnectionId === row.connectionId;
              const rowDisabled = !write.canWrite || rowPending;
              const triggerDisabled = rowDisabled || !row.isPrimary;
              const triggerKinds = issuedDocumentKinds(row.documentKind);
              return (
                <tr key={row.connectionId}>
                  <td>
                    <span>{row.name}</span>
                    <br />
                    <span className="muted-text mono-text">{row.platformType}</span>
                  </td>
                  <td>
                    <StatusBadge tone={toStatusTone(row.status)} compact>
                      {statusLabels[row.status] ?? row.status}
                    </StatusBadge>
                    {row.status === 'needs_reauth' ? (
                      <div className="muted-text">{copy.needsReconnect}</div>
                    ) : null}
                  </td>
                  <td>
                    <StatusBadge tone="neutral" compact>
                      {capabilityLabels[row.capability] ?? row.capability}
                    </StatusBadge>
                  </td>
                  <td>
                    <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
                      <Select
                        aria-label={interpolate(copy.issuesLabel, { name: row.name })}
                        value={row.documentKind ?? ''}
                        disabled={rowDisabled}
                        onChange={(event) => handleIssuesChange(row, event)}
                      >
                        {getSalesDocumentIssuesOptions(row.capability).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </ReadOnlyLock>
                    {row.documentKind === null ? (
                      <div className="muted-text">{copy.notCandidate}</div>
                    ) : null}
                  </td>
                  <td>
                    <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
                      <label className="data-table__radio">
                        <input
                          type="radio"
                          name="sales-document-primary"
                          checked={row.isPrimary}
                          disabled={rowDisabled}
                          onChange={() => handleSelectPrimary(row)}
                          aria-label={interpolate(copy.primaryLabel, { name: row.name })}
                        />
                        <span className="muted-text">{row.isPrimary ? copy.primary : copy.notPrimary}</span>
                      </label>
                    </ReadOnlyLock>
                  </td>
                  <td>
                    {triggerKinds.length === 0
                      ? renderTriggerSelect(row, null, triggerDisabled, false)
                      : triggerKinds.map((kind) =>
                          renderTriggerSelect(row, kind, triggerDisabled, triggerKinds.length > 1),
                        )}
                    {triggerKinds.some((kind) => row.triggerModels[kind] === 'batched') ? (
                      // M15 note 1: the batch screen is reached from the row whose
                      // "When it issues" is Batch, and only from there.
                      <Link
                        className="sales-documents-panel__configure"
                        to={batchScreenPath(row.connectionId)}
                        aria-label={interpolate(copy.configureBatchLabel, { name: row.name })}
                      >
                        {copy.configureBatch}
                      </Link>
                    ) : null}
                  </td>
                  <td>
                    <ZeroLineBadge support={zeroSupportFor(row.connectionId)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted-text">
        {copy.triggerHint}
      </p>
    </div>
  );
}
