/**
 * Sales Documents Tile (#2159)
 *
 * Admin-only settings tile linking to the routing-configuration page
 * (`/settings/sales-documents`, titled "Sales documents routing" since #3656 —
 * "Sales documents" now names the operator-facing `/sales-documents`
 * operations list, not this settings page). Mirrors `McpTokensTile` /
 * `MailerSettingsTile`.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useSalesDocumentRows } from '../hooks/use-sales-document-rows';
import { detectSalesDocumentConflict } from '../lib/detect-sales-document-conflict';
import { useMessages } from '../../../shared/i18n';

export function SalesDocumentsTile(): ReactElement {
  const { connectionsQuery, rows } = useSalesDocumentRows();
  const copy = useMessages('sales-documents').salesDocumentsTile;
  const conflict = detectSalesDocumentConflict(rows);

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <span className="panel__meta">{copy.adminOnly}</span>
      </div>
      <dl className="definition-list">
        <div>
          <dt>{copy.connections}</dt>
          <dd className="mono-text">{connectionsQuery.isLoading ? '…' : rows.length}</dd>
        </div>
      </dl>
      {conflict ? (
        <p className="muted-text" role="alert">
          {copy.conflict}
        </p>
      ) : (
        <p className="muted-text">
          {copy.description}
        </p>
      )}
      <Link className="button button--secondary button--sm" to="/settings/sales-documents">
        {copy.manage}
      </Link>
    </article>
  );
}
