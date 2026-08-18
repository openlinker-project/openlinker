/**
 * Sales Documents Tile (#2159)
 *
 * Admin-only settings tile linking to the Sales Documents page. Mirrors
 * `McpTokensTile` / `MailerSettingsTile`.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useSalesDocumentRows } from '../hooks/use-sales-document-rows';
import { detectSalesDocumentConflict } from '../lib/detect-sales-document-conflict';

export function SalesDocumentsTile(): ReactElement {
  const { connectionsQuery, rows } = useSalesDocumentRows();
  const conflict = detectSalesDocumentConflict(rows);

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Fiscal</p>
          <h3 className="section-title">Sales documents</h3>
        </div>
        <span className="panel__meta">Admin only</span>
      </div>
      <dl className="definition-list">
        <div>
          <dt>Connections</dt>
          <dd className="mono-text">{connectionsQuery.isLoading ? '…' : rows.length}</dd>
        </div>
      </dl>
      {conflict ? (
        <p className="muted-text" role="alert">
          Conflicting primary configuration — needs attention.
        </p>
      ) : (
        <p className="muted-text">
          Which connection issues invoices or fiscal receipts, and which one issues first.
        </p>
      )}
      <Link className="button button--secondary button--sm" to="/settings/sales-documents">
        Manage routing
      </Link>
    </article>
  );
}
