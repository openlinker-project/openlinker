/**
 * Sales Documents Panel (#2159, ADR-041 mockup tab 02 "Configuration")
 *
 * The ONLY editable surface for sales-document routing config. Lists every
 * connection with `Invoicing` or `Fiscalization` enabled and lets an operator
 * set, per row: what it issues (Issues), whether it is the one that auto-
 * issues (Primary — a SINGLE radio group across ALL rows, so the UI cannot
 * express two primaries by construction), and when (Trigger, disabled for a
 * non-primary row since timing is meaningless until a connection is actually
 * the one issuing).
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
import { Alert } from '../../../shared/ui/alert';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { ConnectionStatus } from '../../connections';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { INVOICE_TRIGGER_MODEL_VALUES, INVOICE_TRIGGER_MODEL_LABELS } from '../../connections';
import { useSalesDocumentRows } from '../hooks/use-sales-document-rows';
import { useUpdateSalesDocumentMutation } from '../hooks/use-update-sales-document-mutation';
import { detectSalesDocumentConflict } from '../lib/detect-sales-document-conflict';
import {
  getSalesDocumentIssuesOptions,
  type SalesDocumentKind,
  type SalesDocumentRow,
} from '../api/sales-documents.types';

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
  }
}

const CONFLICT_COPY: Record<'multiple-primaries' | 'ambiguous-no-primary', { title: string; body: string }> = {
  'multiple-primaries': {
    title: 'Two or more connections are set to issue',
    body: 'Until you pick one, OpenLinker issues nothing for new orders. Picking for you would mean guessing, and a wrong document is a legal problem, not a data problem.',
  },
  'ambiguous-no-primary': {
    title: 'No connection is marked primary',
    body: 'Several connections issue a sales document but none is primary, so OpenLinker issues nothing for new orders. Pick exactly one below.',
  },
};

export function SalesDocumentsPanel(): ReactElement {
  const { connectionsQuery, rows } = useSalesDocumentRows();
  const { updateField, isPending } = useUpdateSalesDocumentMutation();
  const [pendingConnectionId, setPendingConnectionId] = useState<string | null>(null);

  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);

  if (connectionsQuery.isLoading) {
    return (
      <LoadingState
        title="Loading connections"
        message="Fetching Invoicing and Fiscalization connections…"
      />
    );
  }

  if (connectionsQuery.error) {
    return (
      <ErrorState
        title="Unable to load connections"
        message={connectionsQuery.error.message}
        action={<Button onClick={() => void connectionsQuery.refetch()}>Retry</Button>}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <Alert tone="info" title="No sales-document connections yet">
        Enable the <code>Invoicing</code> or <code>Fiscalization</code> capability on a connection
        to configure what it issues here.
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

  function handleTriggerChange(row: SalesDocumentRow, event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    void runRowUpdate(row.connectionId, () =>
      updateField({ connectionId: row.connectionId, patch: { triggerModel: value } }),
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
    <div className="page-section">
      {conflict ? (
        <Alert tone="error" title={CONFLICT_COPY[conflict].title}>
          {CONFLICT_COPY[conflict].body}
        </Alert>
      ) : null}

      <p className="muted-text">
        What each connection may issue, whether it goes first, and when. Only one connection may
        go first across ALL of them, whatever it issues — the Primary column is a single choice,
        not one per row. A connection with nothing set here is not a routing candidate at all.
      </p>

      <div className="data-table__container">
        <table className="data-table" aria-label="Sales-document routing per connection">
          <caption className="sr-only">
            Connections and the document each issues, with the single primary connection
          </caption>
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Status</th>
              <th scope="col">Capability</th>
              <th scope="col">Issues</th>
              <th scope="col">Primary</th>
              <th scope="col">Trigger</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowPending = isPending && pendingConnectionId === row.connectionId;
              const rowDisabled = !write.canWrite || rowPending;
              return (
                <tr key={row.connectionId}>
                  <td>
                    <span>{row.name}</span>
                    <br />
                    <span className="muted-text mono-text">{row.platformType}</span>
                  </td>
                  <td>
                    <StatusBadge tone={toStatusTone(row.status)} compact>
                      {row.status}
                    </StatusBadge>
                    {row.status === 'needs_reauth' ? (
                      <div className="muted-text">Cannot issue until reconnected</div>
                    ) : null}
                  </td>
                  <td>
                    <StatusBadge tone="neutral" compact>
                      {row.capability}
                    </StatusBadge>
                  </td>
                  <td>
                    <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                      <Select
                        aria-label={`Document ${row.name} issues`}
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
                      <div className="muted-text">Not a routing candidate</div>
                    ) : null}
                  </td>
                  <td>
                    <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                      <label className="data-table__radio">
                        <input
                          type="radio"
                          name="sales-document-primary"
                          checked={row.isPrimary}
                          disabled={rowDisabled}
                          onChange={() => handleSelectPrimary(row)}
                          aria-label={`Mark ${row.name} as the primary sales-document connection`}
                        />
                        <span className="muted-text">{row.isPrimary ? 'Primary' : '—'}</span>
                      </label>
                    </ReadOnlyLock>
                  </td>
                  <td>
                    <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                      <Select
                        aria-label={`When ${row.name} issues`}
                        value={row.triggerModel}
                        disabled={rowDisabled || !row.isPrimary}
                        onChange={(event) => handleTriggerChange(row, event)}
                      >
                        {INVOICE_TRIGGER_MODEL_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {INVOICE_TRIGGER_MODEL_LABELS[value]}
                          </option>
                        ))}
                      </Select>
                    </ReadOnlyLock>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted-text">
        Trigger is greyed out for a non-primary row since the timing choice does not matter until
        a connection is actually the one issuing.
      </p>
    </div>
  );
}
