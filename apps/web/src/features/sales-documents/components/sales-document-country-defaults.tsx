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
import type { ConcreteDocumentKind, SalesDocumentKind } from '../api/sales-documents.types';

interface SalesDocumentCountryDefaultsProps {
  country: string;
}

interface CountryDefaultCandidate {
  connectionId: string;
  name: string;
  documentKind: ConcreteDocumentKind;
  /** The current default's own connection, offered even without an active role. */
  stale?: boolean;
}

function documentKindLabel(kind: SalesDocumentKind): string {
  return kind === 'invoice' ? 'Invoice' : 'Receipt';
}

/**
 * The readback names the kind in prose, so the article has to follow it — a
 * fixed `a` renders "a Invoice". Only the Receipt branch appears in the
 * mockup, which is why it read correctly there.
 */
function documentKindArticle(kind: SalesDocumentKind): string {
  return kind === 'invoice' ? 'an' : 'a';
}

function countryDisplayName(country: string): string {
  return country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY ? '★ Rest of world' : country;
}

/**
 * A dual-role connection (#3195) can appear as TWO candidate rows sharing one
 * `connectionId` — one per concrete kind — so `connectionId` alone can no
 * longer key the `<select>` option/value in that one case: two options would
 * share a value, and picking one could not be told apart from the other.
 *
 * The composite `{connectionId}:{documentKind}` key is used ONLY when
 * `allOptions` actually contains more than one row for that connection id —
 * every single-role connection (every connection in the tree today) keeps
 * the bare `connectionId` value it always had, so an existing test asserting
 * `toHaveValue('conn_x')` or calling `selectOptions(select, 'conn_x')` is
 * untouched by this change.
 */
function candidateOptionValue(
  candidate: { connectionId: string; documentKind: string },
  allOptions: readonly { connectionId: string }[],
): string {
  const sharesConnectionId =
    allOptions.filter((option) => option.connectionId === candidate.connectionId).length > 1;
  return sharesConnectionId ? `${candidate.connectionId}:${candidate.documentKind}` : candidate.connectionId;
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

  // Eligibility is capability AND role, which is the pair
  // `resolveSalesDocumentRouting` narrows on: `deriveSalesDocumentRows`
  // already keeps only connections with `Invoicing` or `Fiscalization`
  // enabled, and `documentKind !== null` mirrors that resolver's
  // `isEligibleCandidate`. It deliberately does NOT mirror the resolver's
  // step-6 kind-to-capability pairing (`invoice` needs `Invoicing`), so a
  // connection whose role contradicts its capability is still offered here
  // and refused at routing time. `sales-document-rule-composer-dialog.tsx`
  // answers the same question — which connection may a routing decision
  // name — with the capability predicate alone (`selectInvoicingCandidates`
  // / `selectFiscalizationCandidates`); converging the two is a follow-up,
  // not this change.
  // A dual-role connection (#3195, `documentKind: 'both'`) expands into TWO
  // candidate rows sharing the connection id — one per concrete kind — so
  // the operator can pick which kind THIS country falls back to on that
  // connection, exactly as `expandSalesDocumentRoutingCandidates` expands the
  // same config for routing on the backend. Every other role expands to the
  // one row it always did.
  const candidates: CountryDefaultCandidate[] = rows
    .filter((row) => row.status === 'active' && row.documentKind !== null)
    .flatMap((row): CountryDefaultCandidate[] => {
      // The `.filter` above already excludes `null`, but a plain boolean
      // predicate doesn't narrow the element type for `.flatMap` — re-assert
      // it here so `row.documentKind` below is `SalesDocumentKind`, not
      // `SalesDocumentKind | null`.
      if (row.documentKind === null) {
        return [];
      }
      if (row.documentKind === 'both') {
        return (['invoice', 'fiscal-receipt'] as const).map((documentKind) => ({
          connectionId: row.connectionId,
          name: row.name,
          documentKind,
        }));
      }
      return [
        {
          connectionId: row.connectionId,
          name: row.name,
          documentKind: row.documentKind,
        },
      ];
    });

  // At most one row per country now (#3177) — the unique index is on
  // `country` alone.
  const current = (defaultsQuery.data ?? [])[0] ?? null;

  // The current default's own connection may have lost its role or gone
  // inactive since it was chosen — offer it anyway rather than letting it
  // silently drop out of the option list (the `resolveIssuingConnection`
  // "stale but still named" precedent). Matched by connection AND kind
  // (#3195) — a dual-role connection's persisted default names one concrete
  // kind, and matching by connectionId alone would (wrongly) count it as
  // "still a candidate" even if only the OTHER kind survived.
  const currentIsAmongCandidates =
    current !== null &&
    candidates.some(
      (c) => c.connectionId === current.connectionId && c.documentKind === current.documentKind,
    );
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
          value={current ? candidateOptionValue(current, options) : ''}
          disabled={!write.canWrite || isPending}
          onChange={(event) => {
            const value = event.target.value;
            if (value === '') {
              if (current) remove.mutate(current.id);
              return;
            }
            const candidate = options.find((c) => candidateOptionValue(c, options) === value);
            if (!candidate) return;
            upsert.mutate({
              country,
              documentKind: candidate.documentKind,
              connectionId: candidate.connectionId,
            });
          }}
        >
          <option value="">Nothing — hold the order</option>
          {options.map((c) => (
            <option key={candidateOptionValue(c, options)} value={candidateOptionValue(c, options)}>
              {documentKindLabel(c.documentKind)} · {c.name}
              {c.stale ? ' (no longer eligible)' : ''}
            </option>
          ))}
        </Select>
      </ReadOnlyLock>
      <p className="muted-text">
        Options: <b>Nothing — hold the order</b>, or any one connection with a role.
      </p>
      {/* The mockup renders this as a tinted, bordered callout under its own
          `.readback` rule, but that rule is built on `--info-*` tokens the
          app's `index.css` does not declare. Reproducing it would mean
          inventing design tokens, so the readback uses the classes this
          component and its siblings already use. */}
      <div data-testid="country-default-readback">
        <p className="eyebrow" style={{ marginBottom: 2 }}>
          Which means
        </p>
        {current ? (
          <p className="muted-text">
            An order in <b>{displayCountry}</b> matching none of the rules above gets{' '}
            {documentKindArticle(current.documentKind)}{' '}
            <b>{documentKindLabel(current.documentKind)}</b> through{' '}
            <b>
              {connections.find((c) => c.id === current.connectionId)?.name ??
                current.connectionId}
            </b>
            .
          </p>
        ) : (
          <p className="muted-text">
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
