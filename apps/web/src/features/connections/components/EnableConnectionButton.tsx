/**
 * Enable Connection Button
 *
 * Returns a `disabled` connection to `active` by patching its status (#1940).
 * Shared by the two surfaces that offer the recovery — the Actions panel row and
 * the detail page's sync-paused banner — so the mutation, the toast copy, and the
 * demo-mode lock live in one place instead of once per surface.
 *
 * Visibility is the caller's decision: both call sites already branch on
 * `connections:write` before mounting this. The component owns interactivity only
 * (pending state and the demo read-only lock).
 *
 * There is deliberately no confirm dialog. Disable opens one because it stops
 * every job on a live integration; enabling is the recovery from that and should
 * not charge an extra click.
 *
 * @module features/connections/components
 * @see {@link ConnectionActionsPanel} for the Actions-tab row
 */
import type { ReactElement } from 'react';
import type { Connection } from '../api/connections.types';
import { useUpdateConnectionMutation } from '../hooks/use-update-connection-mutation';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';

interface EnableConnectionButtonProps {
  connection: Connection;
  /** Defaults to the terse form used inside the Actions panel's row. */
  label?: string;
}

export function EnableConnectionButton({
  connection,
  label = 'Enable',
}: EnableConnectionButtonProps): ReactElement {
  const updateConnection = useUpdateConnectionMutation();
  const { showToast } = useToast();

  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);

  async function handleEnable(): Promise<void> {
    try {
      await updateConnection.mutateAsync({
        connectionId: connection.id,
        input: { status: 'active' },
      });
      showToast({
        tone: 'success',
        title: 'Connection enabled',
        description: `"${connection.name}" is active again. Syncing resumes on the next scheduled run.`,
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Unable to enable connection',
        description: (error as Error).message,
      });
    }
  }

  return (
    <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
      <Button
        disabled={updateConnection.isPending || write.demoReadOnly}
        onClick={() => void handleEnable()}
      >
        {updateConnection.isPending ? 'Enabling…' : label}
      </Button>
    </ReadOnlyLock>
  );
}
