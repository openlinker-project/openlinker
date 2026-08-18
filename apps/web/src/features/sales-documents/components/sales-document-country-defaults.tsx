/**
 * Sales-Document Country Defaults (#2170, mockup tab 02 "Poland's own defaults")
 *
 * Tier 2 of the fallback ladder: per document kind, the connection a country
 * falls back to when no rule matches. Each select is filtered to connections
 * declaring the capability that document kind requires (`Invoicing` /
 * `Fiscalization`) — an incapable connection can't even be selected, matching
 * `resolveSalesDocumentRouting`'s own structural capability check.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import type { ReactElement } from 'react';
import { useConnectionsQuery } from '../../connections';
import { selectInvoicingCandidates } from '../../invoicing';
import { selectFiscalizationCandidates } from '../../fiscalization';
import { Select } from '../../../shared/ui/select';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { useSalesDocumentCountryDefaultsQuery } from '../hooks/use-sales-document-country-defaults-query';
import { useUpsertSalesDocumentCountryDefaultMutation } from '../hooks/use-upsert-sales-document-country-default-mutation';
import { useDeleteSalesDocumentCountryDefaultMutation } from '../hooks/use-delete-sales-document-country-default-mutation';
import type { SalesDocumentKind } from '../api/sales-documents.types';

interface SalesDocumentCountryDefaultsProps {
  country: string;
}

const KIND_CONFIG: readonly {
  documentKind: SalesDocumentKind;
  label: string;
  capability: 'Invoicing' | 'Fiscalization';
}[] = [
  { documentKind: 'invoice', label: 'Invoice', capability: 'Invoicing' },
  { documentKind: 'fiscal-receipt', label: 'Receipt', capability: 'Fiscalization' },
];

export function SalesDocumentCountryDefaults({
  country,
}: SalesDocumentCountryDefaultsProps): ReactElement {
  const connectionsQuery = useConnectionsQuery();
  const defaultsQuery = useSalesDocumentCountryDefaultsQuery(country);
  const upsert = useUpsertSalesDocumentCountryDefaultMutation();
  const remove = useDeleteSalesDocumentCountryDefaultMutation();
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);

  if (connectionsQuery.isLoading || defaultsQuery.isLoading) {
    return <LoadingState title="Loading defaults" message="Fetching country defaults…" />;
  }
  if (connectionsQuery.error || defaultsQuery.error) {
    return (
      <ErrorState
        title="Unable to load defaults"
        message={(connectionsQuery.error ?? defaultsQuery.error)?.message ?? 'Unknown error'}
      />
    );
  }

  const connections = connectionsQuery.data ?? [];
  const defaults = defaultsQuery.data ?? [];

  return (
    <div className="page-section">
      <p className="eyebrow" style={{ marginBottom: 2 }}>
        Defaults for {country === '*' ? '★ Rest of world' : country}
      </p>
      <div className="frame-grid frame-grid--2">
        {KIND_CONFIG.map(({ documentKind, label, capability }) => {
          const candidates =
            capability === 'Invoicing'
              ? selectInvoicingCandidates(connections)
              : selectFiscalizationCandidates(connections);
          const current = defaults.find((d) => d.documentKind === documentKind) ?? null;

          return (
            <div key={documentKind} className="page-section">
              <label className="eyebrow" htmlFor={`sd-default-${documentKind}`} style={{ marginBottom: 2 }}>
                {label}
              </label>
              <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                <Select
                  id={`sd-default-${documentKind}`}
                  value={current?.connectionId ?? ''}
                  disabled={!write.canWrite || candidates.length === 0}
                  onChange={(event) => {
                    const connectionId = event.target.value;
                    if (connectionId === '') {
                      if (current) void remove.mutateAsync(current.id);
                      return;
                    }
                    void upsert.mutateAsync({ country, documentKind, connectionId });
                  }}
                >
                  <option value="">Not set</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </ReadOnlyLock>
              <p className="muted-text">
                Filtered to connections with <span className="chip mono-text">{capability}</span>.
                {candidates.length === 0 ? ' No eligible connection yet.' : null}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
