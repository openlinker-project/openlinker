/**
 * Sync Trigger Card
 *
 * The "run a sync now" control of the connection's Sync tab: one panel with the
 * button that opens the manual trigger dialog. It used to be a row of the
 * Actions list; the whole sync story (queue, order import, catalogue, manual
 * runs) now sits on one tab.
 *
 * @module features/connections/components
 */
import { useState, type ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { captureDemoEvent } from '../../demo';
import { TriggerSyncDialog } from '../../sync-jobs';
import { useDemoMode } from '../../system';
import type { Connection } from '../api/connections.types';

interface SyncTriggerCardProps {
  connection: Connection;
}

export function SyncTriggerCard({ connection }: SyncTriggerCardProps): ReactElement | null {
  const copy = useMessages('connections').connectionActionsPanel.sync;
  const demoMode = useDemoMode();
  const sync = useWriteAccess('sync:write', demoMode);
  const [open, setOpen] = useState(false);

  // A disabled or archived connection resolves no adapter, so a manual run would only fail.
  if (!sync.visible || connection.status === 'disabled' || connection.status === 'archived') {
    return null;
  }

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <Button
          tone="primary"
          onClick={() => {
            captureDemoEvent('demo_connection_sync_dialog_opened', {});
            setOpen(true);
          }}
        >
          {copy.action}
        </Button>
      </div>
      <p className="muted-text">{copy.help}</p>
      <TriggerSyncDialog
        connection={connection}
        open={open}
        onOpenChange={setOpen}
        submitDisabled={sync.demoReadOnly}
      />
    </div>
  );
}
