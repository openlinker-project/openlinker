/**
 * Archive Connection Button
 *
 * The soft delete for a disabled connection (#3657): a button plus the
 * confirmation dialog it opens. Shared by the `/connections` list row and the
 * connection detail page's Actions panel, so the mutation, the copy, the typed
 * name check and the demo-mode lock live in one place.
 *
 * The operator has to type the connection's name before the confirm button
 * enables. Archiving removes the stored credential, so undoing it is a restore
 * plus re-entering credentials - enough of a cost to make the operator name
 * what they are about to hide, not just click twice.
 *
 * A connection another connection still uses as its catalog is refused (409,
 * `master-catalog-referenced`); the dialog then lists those connections with a
 * link to each one's edit page, where the catalog pairing is changed.
 *
 * Visibility is the caller's decision (both call sites branch on
 * `connections:write` and on `status === 'disabled'`). The component owns
 * interactivity only.
 *
 * @module features/connections/components
 * @see {@link RestoreConnectionButton} for the way back
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { Connection } from '../api/connections.types';
import { useArchiveConnectionMutation } from '../hooks/use-archive-connection-mutation';
import { readCatalogReferrers } from '../lib/archive-connection-refusal';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Alert } from '../../../shared/ui/alert';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';

interface ArchiveConnectionButtonProps {
  connection: Connection;
  /** Defaults to the terse form used inside a table row. */
  label?: string;
}

export function ArchiveConnectionButton({
  connection,
  label = 'Archive',
}: ArchiveConnectionButtonProps): ReactElement {
  const archiveConnection = useArchiveConnectionMutation();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const [isOpen, setIsOpen] = useState(false);
  const [typedName, setTypedName] = useState('');

  const nameMatches = typedName.trim() === connection.name.trim();
  // Named, not summarised: once archived this connection leaves every list,
  // so the operator must learn here which connections to re-pair.
  const catalogReferrers = readCatalogReferrers(archiveConnection.error);

  function handleOpenChange(open: boolean): void {
    setIsOpen(open);
    if (!open) {
      setTypedName('');
      archiveConnection.reset();
    }
  }

  async function handleConfirm(): Promise<void> {
    try {
      await archiveConnection.mutateAsync(connection.id);
      handleOpenChange(false);
      showToast({
        tone: 'success',
        title: 'Connection archived',
        description: `"${connection.name}" is hidden from your connections. You can restore it from the Archived filter.`,
      });
    } catch {
      // The error renders inside the dialog; keeping it open lets the
      // operator read it and retry without retyping the name.
    }
  }

  return (
    <>
      <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
        <Button
          tone="danger"
          onClick={() => setIsOpen(true)}
          disabled={archiveConnection.isPending || write.demoReadOnly}
        >
          {label}
        </Button>
      </ReadOnlyLock>

      <ConfirmDialog
        open={isOpen}
        onOpenChange={handleOpenChange}
        title="Archive this connection?"
        description={`"${connection.name}" will disappear from your connections and from every place you pick a connection.`}
        body={
          <div className="archive-connection-dialog__body">
            <ul className="archive-connection-dialog__list">
              <li>Its saved credentials are deleted.</li>
              <li>Mappings, orders, offers and job history are kept and still show its name.</li>
              <li>You can restore it later, but you will need to enter its credentials again.</li>
            </ul>
            <FormField label={`Type "${connection.name}" to confirm`} name="archive-confirm-name">
              <Input
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
                autoComplete="off"
              />
            </FormField>
            {catalogReferrers ? (
              <Alert tone="error" title="Other connections still use this catalog">
                <p>{`"${connection.name}" is the catalog connection of:`}</p>
                <ul className="archive-connection-dialog__list">
                  {catalogReferrers.map((referrer) => (
                    <li key={referrer.id}>
                      <Link className="link" to={`/connections/${referrer.id}/edit`}>
                        {referrer.name}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p>Change their catalog pairing first, then archive this connection.</p>
              </Alert>
            ) : archiveConnection.error ? (
              <Alert tone="error" title="Unable to archive connection">
                {archiveConnection.error.message}
              </Alert>
            ) : null}
          </div>
        }
        confirmLabel="Archive connection"
        cancelLabel="Keep it"
        tone="danger"
        initialFocus="cancel"
        confirmDisabled={!nameMatches}
        isConfirming={archiveConnection.isPending}
        onConfirm={() => {
          void handleConfirm();
        }}
      />
    </>
  );
}
