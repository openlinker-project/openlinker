/**
 * Sales-Document Country Default (#2170, #3177, mockup "If no rule matched")
 *
 * Tier 2 of the fallback ladder: the ONE connection a country falls back to
 * when no rule matches, or "Nothing — hold the order". Before #3177 this
 * rendered two independent selects (Invoice / Receipt) — setting both was a
 * live, silently-accepted misconfiguration: `sales_document_country_defaults`
 * carried a row per `(country, documentKind)`, so a country could hold an
 * invoice default AND a receipt default at once, which disabled the fallback
 * step ENTIRELY (`evaluateSalesDocumentRules` reads `ambiguous-defaults` as
 * `unresolved`) and left an unmatched order held with no explanation on this
 * screen. The backend now enforces uniqueness on `country` alone, so at most
 * one default row can ever exist per country — this component collapses to
 * ONE control to match, rather than merely detecting the old contradiction
 * after the fact.
 *
 * A candidate is any connection carrying a "role" — `config.salesDocument.
 * documentKind` set via the Connected-providers configuration
 * (`deriveSalesDocumentRows`) — because the role is what fixes which document
 * kind selecting that connection means; the operator never picks a kind here.
 * The current default's own connection is always offered even if it has
 * since lost its role or gone inactive, so switching it away is possible
 * without it silently vanishing from the list.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import type { ReactElement } from 'react';
import { useConnectionsQuery } from '../../connections';
import { Select } from '../../../shared/ui/select';
import { Alert } from '../../../shared/ui/alert';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { useSalesDocumentCountryDefaultsQuery } from '../hooks/use-sales-document-country-defaults-query';
import { useUpsertSalesDocumentCountryDefaultMutation } from '../hooks/use-upsert-sales-document-country-default-mutation';
import { useDeleteSalesDocumentCountryDefaultMutation } from '../hooks/use-delete-sales-document-country-default-mutation';
import { deriveSalesDocumentRows } from '../lib/derive-sales-document-rows';
import { SALES_DOCUMENT_REST_OF_WORLD_COUNTRY } from '../api/sales-document-rules.types';
import type { SalesDocumentKind } from '../api/sales-documents.types';

interface SalesDocumentCountryDefaultsProps {
  country: string;
}

interface CountryDefaultCandidate {
  connectionId: string;
  name: string;
  documentKind: SalesDocumentKind;
  /** The current default's own connection, offered even without an active role. */
  stale?: boolean;
}

function documentKindLabel(kind: SalesDocumentKind): string {
  return kind === 'invoice' ? 'Invoice' : 'Receipt';
}

function countryDisplayName(country: string): string {
  return country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY ? '★ Rest of world' : country;
}

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
    return <LoadingState title="Loading default" message="Fetching the country default…" />;
  }
  if (connectionsQuery.error || defaultsQuery.error) {
    return (
      <ErrorState
        title="Unable to load default"
        message={(connectionsQuery.error ?? defaultsQuery.error)?.message ?? 'Unknown error'}
      />
    );
  }

  const connections = connectionsQuery.data ?? [];
  const rows = deriveSalesDocumentRows(connections);

  const candidates: CountryDefaultCandidate[] = rows
    .filter((row) => row.status === 'active' && row.documentKind !== null)
    .map((row) => ({
      connectionId: row.connectionId,
      name: row.name,
      documentKind: row.documentKind as SalesDocumentKind,
    }));

  // At most one row per country now (#3177) — the unique index is on
  // `country` alone.
  const current = (defaultsQuery.data ?? [])[0] ?? null;

  // The current default's own connection may have lost its role or gone
  // inactive since it was chosen — offer it anyway rather than letting it
  // silently drop out of the option list (the `resolveIssuingConnection`
  // "stale but still named" precedent).
  const currentIsAmongCandidates =
    current !== null && candidates.some((c) => c.connectionId === current.connectionId);
  const staleCurrentCandidate: CountryDefaultCandidate | null =
    current !== null && !currentIsAmongCandidates
      ? {
          connectionId: current.connectionId,
          name:
            connections.find((c) => c.id === current.connectionId)?.name ?? current.connectionId,
          documentKind: current.documentKind,
          stale: true,
        }
      : null;
  const options = staleCurrentCandidate ? [...candidates, staleCurrentCandidate] : candidates;

  const isPending = upsert.isPending || (remove.isPending && current !== null);
  const displayCountry = countryDisplayName(country);

  return (
    <div className="page-section">
      <p className="eyebrow" style={{ marginBottom: 2 }}>
        If no rule matched
        {isPending ? ' — Saving…' : null}
      </p>
      <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
        <Select
          id="sd-country-default"
          data-testid="country-default"
          value={current?.connectionId ?? ''}
          disabled={!write.canWrite || isPending}
          onChange={(event) => {
            const connectionId = event.target.value;
            if (connectionId === '') {
              if (current) remove.mutate(current.id);
              return;
            }
            const candidate = options.find((c) => c.connectionId === connectionId);
            if (!candidate) return;
            upsert.mutate({ country, documentKind: candidate.documentKind, connectionId });
          }}
        >
          <option value="">Nothing — hold the order</option>
          {options.map((c) => (
            <option key={c.connectionId} value={c.connectionId}>
              {documentKindLabel(c.documentKind)} · {c.name}
              {c.stale ? ' (no longer eligible)' : ''}
            </option>
          ))}
        </Select>
      </ReadOnlyLock>
      <p className="hint">
        Options: <b>Nothing — hold the order</b>, or any one connection with a role.
      </p>
      <div className="readback" data-testid="country-default-readback">
        <p className="eyebrow">Which means</p>
        {current ? (
          <p>
            An order in <b>{displayCountry}</b> matching none of the rules above gets a{' '}
            <b>{documentKindLabel(current.documentKind)}</b> through{' '}
            <b>
              {connections.find((c) => c.id === current.connectionId)?.name ??
                current.connectionId}
            </b>
            .
          </p>
        ) : (
          <p>
            An order in <b>{displayCountry}</b> matching none of the rules above has no fallback
            here and is <b>held</b>.
          </p>
        )}
      </div>
      {candidates.length === 0 ? (
        <p className="muted-text">
          No connection has a role here yet — give one under Connected providers.
        </p>
      ) : null}
      {upsert.isError ? <Alert tone="error">{upsert.error.message}</Alert> : null}
      {remove.isError ? <Alert tone="error">{remove.error.message}</Alert> : null}
    </div>
  );
}
