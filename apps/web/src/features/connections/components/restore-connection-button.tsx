/**
 * Restore Connection Button
 *
 * Returns an archived connection to `disabled` (#3657). Shared by the
 * `/connections` list row and the detail page, the `EnableConnectionButton`
 * shape. No confirm dialog: restoring hides nothing and moves no data, and the
 * connection comes back disabled, so nothing starts running.
 *
 * The toast says the next step out loud, because a restored connection has no
 * credentials - archiving deleted them - and cannot be enabled until they are
 * entered again.
 *
 * @module features/connections/components
 * @see {@link ArchiveConnectionButton}
 */
import { interpolate, useMessages } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import type { Connection } from '../api/connections.types';
import { useRestoreConnectionMutation } from '../hooks/use-restore-connection-mutation';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { describeApiError } from '../../../shared/api/describe-api-error';

interface RestoreConnectionButtonProps {
  connection: Connection;
  label?: string;
}

export function RestoreConnectionButton({
  connection,
  label,
}: RestoreConnectionButtonProps): ReactElement {
  const copy = useMessages('connections').restoreConnectionButton;
  const restoreConnection = useRestoreConnectionMutation();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);

  async function handleRestore(): Promise<void> {
    try {
      await restoreConnection.mutateAsync(connection.id);
      showToast({
        tone: 'success',
        title: copy.successTitle,
        description: interpolate(copy.successDescription, { name: connection.name }),
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.errorTitle,
        description: describeApiError(error, 'connections'),
      });
    }
  }

  return (
    <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
      <Button
        onClick={() => {
          void handleRestore();
        }}
        disabled={restoreConnection.isPending || write.demoReadOnly}
      >
        {restoreConnection.isPending ? copy.restoring : (label ?? copy.restore)}
      </Button>
    </ReadOnlyLock>
  );
}
