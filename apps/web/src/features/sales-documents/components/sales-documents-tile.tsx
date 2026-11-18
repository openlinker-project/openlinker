/**
 * Sales Documents Tile
 *
 * Settings-index row linking to the sales documents page. The connection count
 * is the value; a routing conflict replaces the description with a warning.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import type { ReactElement } from 'react';
import { useSalesDocumentRows } from '../hooks/use-sales-document-rows';
import { detectSalesDocumentConflict } from '../lib/detect-sales-document-conflict';
import { useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';

function SalesDocumentsLive(): ReactElement {
  const { connectionsQuery, rows } = useSalesDocumentRows();
  const copy = useMessages('sales-documents').salesDocumentsTile;
  const conflict = detectSalesDocumentConflict(rows);

  return (
    <SettingsIndexRow
      icon="document"
      tone={conflict ? 'warning' : 'neutral'}
      title={copy.title}
      description={
        conflict ? (
          <span role="alert" className="settings-row__warning">
            {copy.conflict}
          </span>
        ) : (
          copy.description
        )
      }
      valueState={connectionsQuery.isLoading ? 'loading' : connectionsQuery.isError ? 'error' : 'ready'}
      value={rows.length}
      note={copy.connections}
      action={{ label: copy.manage, to: '/settings/sales-documents' }}
    />
  );
}

export function SalesDocumentsTile({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('sales-documents').salesDocumentsTile;
  return locked ? (
    <SettingsIndexRow locked icon="document" title={copy.title} description={copy.description} />
  ) : (
    <SalesDocumentsLive />
  );
}
