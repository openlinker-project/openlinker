/**
 * Sales Document Status Section (#2159)
 *
 * READ-ONLY summary of this connection's sales-document routing config
 * (`config.salesDocument.documentKind` / `config.invoicing.isPrimary`) plus a
 * link to the single editable surface — Settings → Sales documents.
 *
 * Renamed and demoted from `InvoicingPrimarySection` (#2047), which rendered
 * an editable "Auto-issue invoices on this connection" checkbox. That shape
 * broke the moment a second document kind (fiscal receipt, #1908) existed:
 * "primary" is a CROSS-connection concept (ADR-041 decision 3a — exactly one
 * primary among ALL Invoicing + Fiscalization candidates, regardless of which
 * capability each carries), and it cannot be set correctly from inside one
 * connection's own edit form without seeing every other candidate at once. N
 * independent checkboxes across N connection forms is exactly the shape that
 * produces a conflict (two sessions, two saves, neither aware of the other).
 *
 * STALE as of the "opcja b" fallback retirement: `AutoIssueTriggerService`
 * no longer consults `config.invoicing.isPrimary` at all, so the
 * "Primary"/"Not primary" badge below reports a flag the backend never
 * reads. Tracked for a follow-up pass — this section needs to report the
 * connection's role in the rule-engine routing instead (or be retired).
 *
 * @module features/connections/components
 */
import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { Connection } from '../api/connections.types';
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

type DocumentKind = 'invoice' | 'fiscal-receipt';

function readDocumentKind(config: Record<string, unknown>): DocumentKind | null {
  const salesDocument = isRecord(config.salesDocument) ? config.salesDocument : {};
  const raw = salesDocument.documentKind;
  return raw === 'invoice' || raw === 'fiscal-receipt' ? raw : null;
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

const ISSUES_LABEL: Record<DocumentKind, string> = {
  invoice: 'Invoice',
  'fiscal-receipt': 'Fiscal receipt',
};

export function SalesDocumentStatusSection({
  connection,
  allConnections,
}: SalesDocumentStatusSectionProps): ReactElement {
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
      <h3 className="rate-limit-section__title">Sales document</h3>
      <KeyValueList
        items={[
          {
            id: 'issues',
            label: 'Issues',
            value: documentKind ? ISSUES_LABEL[documentKind] : 'Nothing',
          },
          {
            id: 'status',
            label: 'Status',
            value: isPrimary ? (
              <StatusBadge tone="success" withDot>
                Primary
              </StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Not primary</StatusBadge>
            ),
          },
        ]}
      />
      <p className="rate-limit-section__help">
        Read-only. <Link to="/settings/sales-documents">Manage in Settings → Sales documents</Link>
        {otherPrimary ? ` ${otherPrimary.name} is already primary.` : ''}
      </p>
    </section>
  );
}
