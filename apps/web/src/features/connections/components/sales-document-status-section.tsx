/**
 * Sales Document Status Section (#2159)
 *
 * READ-ONLY summary of this connection's sales-document routing config
 * (`config.salesDocument.documentKind` / `config.invoicing.isPrimary`) plus a
 * link to the single editable surface - Settings -> Sales documents routing.
 *
 * Renamed and demoted from `InvoicingPrimarySection` (#2047), which rendered
 * an editable "Auto-issue invoices on this connection" checkbox. That shape
 * broke the moment a second document kind (fiscal receipt, #1908) existed:
 * "primary" is a CROSS-connection concept (ADR-041 decision 3a — exactly one
 * primary among ALL Invoicing + Fiscalization candidates, regardless of which
 * capability each carries), and it cannot be set correctly from inside one
 * connection's own edit form without seeing every other candidate at once. N
 * independent checkboxes across N connection forms is exactly the shape that
 * produces a conflict (two sessions, two saves, neither aware of the other) —
 * a single radio group in one place (`SalesDocumentsPanel`) structurally
 * eliminates that possibility at the UI level.
 *
 * @module features/connections/components
 */
import { interpolate, renderRich, useMessages } from '../../../shared/i18n';
import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { Connection } from '../api/connections.types';
import { Alert } from '../../../shared/ui/alert';
import { KeyValueList } from '../../../shared/ui/key-value-list';
import { StatusBadge } from '../../../shared/ui/status-badge';

export interface SalesDocumentStatusSectionProps {
  connection: Connection;
  /**
   * Sibling connections (any status) — used only to name the connection that
   * IS primary when this one isn't, mirroring the mockup's "inFakt is
   * already primary" hint. Pass the same list the host form already fetches
   * for the master-catalog picker; an empty array degrades gracefully (no hint).
   */
  allConnections: readonly Connection[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type DocumentKind = 'invoice' | 'fiscal-receipt' | 'both';

function readDocumentKind(config: Record<string, unknown>): DocumentKind | null {
  const salesDocument = isRecord(config.salesDocument) ? config.salesDocument : {};
  const raw = salesDocument.documentKind;
  return raw === 'invoice' || raw === 'fiscal-receipt' || raw === 'both' ? raw : null;
}

function readIsPrimary(config: Record<string, unknown>): boolean {
  const invoicing = isRecord(config.invoicing) ? config.invoicing : {};
  return invoicing.isPrimary === true || invoicing.isPrimary === 'true';
}

function isSalesDocumentCandidate(connection: Connection): boolean {
  return (
    connection.enabledCapabilities.includes('Invoicing') ||
    connection.enabledCapabilities.includes('Fiscalization')
  );
}


export function SalesDocumentStatusSection({
  connection,
  allConnections,
}: SalesDocumentStatusSectionProps): ReactElement {
  const copy = useMessages('connections').salesDocumentStatusSection;
  const documentKind = readDocumentKind(connection.config);
  const isPrimary = readIsPrimary(connection.config);

  const otherPrimary = isPrimary
    ? undefined
    : allConnections.find(
        (candidate) =>
          candidate.id !== connection.id &&
          isSalesDocumentCandidate(candidate) &&
          readIsPrimary(candidate.config),
      );

  return (
    <section className="rate-limit-section">
      <h3 className="rate-limit-section__title">{copy.title}</h3>
      <KeyValueList
        items={[
          {
            id: 'issues',
            label: copy.issues,
            value: documentKind ? copy.issuesLabels[documentKind] : copy.nothing,
          },
          {
            id: 'status',
            label: copy.status,
            value: isPrimary ? (
              <StatusBadge tone="success" withDot>
                {copy.primary}
              </StatusBadge>
            ) : (
              <StatusBadge tone="neutral">{copy.notPrimary}</StatusBadge>
            ),
          },
        ]}
      />
      {documentKind === 'both' ? (
        <Alert tone="warning" data-testid="sales-document-dual-role-warning">
          {copy.dualRoleWarning}
        </Alert>
      ) : null}
      <p className="rate-limit-section__help">
        {renderRich(copy.readOnly, {
          link: (text) => <Link to="/settings/sales-documents">{text}</Link>,
        })}
        {otherPrimary ? ' ' + interpolate(copy.otherPrimary, { name: otherPrimary.name }) : ''}
      </p>
    </section>
  );
}
