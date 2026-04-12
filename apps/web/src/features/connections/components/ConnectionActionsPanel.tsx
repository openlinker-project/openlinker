import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { Connection } from '../api/connections.types';
import { useDisableConnectionMutation } from '../hooks/use-disable-connection-mutation';
import { useEnqueueSyncJobMutation } from '../../sync-jobs/hooks/use-enqueue-sync-job-mutation';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Alert } from '../../../shared/ui/alert';
import { useToast } from '../../../shared/ui/toast-provider';

// TODO(#164): derive from resolved adapter capabilities on the connection detail
// endpoint rather than hardcoding platform types. A second ProductMaster adapter
// (e.g. Shopify) will silently hide this button until then.
const PRODUCT_MASTER_PLATFORMS = ['prestashop'];

interface ConnectionActionsPanelProps {
  connection: Connection;
}

export function ConnectionActionsPanel({ connection }: ConnectionActionsPanelProps): ReactElement {
  const disableConnection = useDisableConnectionMutation();
  const enqueueSyncJob = useEnqueueSyncJobMutation();
  const { showToast } = useToast();
  const [isDisableDialogOpen, setIsDisableDialogOpen] = useState(false);

  const isDisabled = connection.status === 'disabled';
  const supportsProductMaster = PRODUCT_MASTER_PLATFORMS.includes(connection.platformType);

  const handleSyncProducts = async (): Promise<void> => {
    try {
      await enqueueSyncJob.mutateAsync({
        connectionId: connection.id,
        jobType: 'master.product.syncAll',
        payload: { schemaVersion: 1 },
        idempotencyKey: `manual:${connection.id}:product:syncAll:${Date.now()}`,
      });
      showToast({
        tone: 'success',
        title: 'Product sync started',
        description: `Catalog discovery for "${connection.name}" has been enqueued.`,
      });
    } catch {
      // Surfaced via enqueueSyncJob.error alert below.
    }
  };

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Operator</p>
          <h3 className="section-title">Actions</h3>
        </div>
        <span className="panel__meta">Manage connection</span>
      </div>

      {disableConnection.error ? (
        <Alert tone="error" title="Unable to disable connection">
          {disableConnection.error.message}
        </Alert>
      ) : null}

      {enqueueSyncJob.error ? (
        <Alert tone="error" title="Unable to start product sync">
          {enqueueSyncJob.error.message}
        </Alert>
      ) : null}

      <div className="action-list">
        <div className="action-list__item">
          <div>
            <strong>Edit connection</strong>
            <p className="muted-text">Update name, config, or adapter settings.</p>
          </div>
          <Link className="button button--secondary" to={`/connections/${connection.id}/edit`}>
            Edit
          </Link>
        </div>

        {supportsProductMaster && !isDisabled ? (
          <div className="action-list__item">
            <div>
              <strong>Sync products now</strong>
              <p className="muted-text">
                Enumerate the source catalog and enqueue a per-product sync. Safe to run anytime;
                runs also happen on the recurring schedule.
              </p>
            </div>
            <Button
              tone="primary"
              onClick={() => void handleSyncProducts()}
              disabled={enqueueSyncJob.isPending}
            >
              {enqueueSyncJob.isPending ? 'Enqueuing...' : 'Sync now'}
            </Button>
          </div>
        ) : null}

        {isDisabled ? null : (
          <div className="action-list__item">
            <div>
              <strong>Disable connection</strong>
              <p className="muted-text">Stop all sync activity for this connection. This can be reversed by re-enabling.</p>
            </div>
            <Button
              tone="danger"
              onClick={() => setIsDisableDialogOpen(true)}
              disabled={disableConnection.isPending}
            >
              {disableConnection.isPending ? 'Disabling...' : 'Disable'}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={isDisableDialogOpen}
        onOpenChange={setIsDisableDialogOpen}
        title="Disable this connection?"
        description={`This will stop all sync activity for "${connection.name}". You can re-enable it later.`}
        confirmLabel="Disable connection"
        cancelLabel="Keep active"
        tone="danger"
        onConfirm={async () => {
          try {
            await disableConnection.mutateAsync(connection.id);
            setIsDisableDialogOpen(false);
            showToast({
              tone: 'success',
              title: 'Connection disabled',
              description: `"${connection.name}" has been disabled.`,
            });
          } catch {
            setIsDisableDialogOpen(false);
          }
        }}
      />
    </div>
  );
}
