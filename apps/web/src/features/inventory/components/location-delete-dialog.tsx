/**
 * Location Delete Dialog (#2316 / #3068)
 *
 * `DELETE /inventory/locations/:id` is refused with a 409
 * (`LocationInUseError`) while any `inventory_items` row still references the
 * location — there is no cheap way to know this ahead of the attempt (the
 * list read carries no such signal today), so this dialog always starts in
 * `confirm` and only learns `in-use` from the failed delete itself, exactly
 * the reviewed mockup's interaction:
 * https://claude.ai/code/artifact/fbb5f9e1-52a3-4b7b-8136-ad59dcf4f318
 *
 * On `in-use` the SAME dialog swaps its body and its confirm action to
 * "Retire instead" (`PATCH { status: 'inactive' }`) rather than closing and
 * reopening a second dialog — the operator's next step is right there rather
 * than requiring them to find a new control.
 *
 * @module apps/web/src/features/inventory/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { useToast } from '../../../shared/ui/toast-provider';
import { ApiError } from '../../../shared/api/api-error';
import { useDeleteInventoryLocationMutation } from '../hooks/use-delete-inventory-location-mutation';
import { useUpdateInventoryLocationMutation } from '../hooks/use-update-inventory-location-mutation';
import type { InventoryLocation } from '../api/inventory-locations.types';

interface LocationDeleteDialogProps {
  location: InventoryLocation | null;
  onClose: () => void;
}

export function LocationDeleteDialog({ location, onClose }: LocationDeleteDialogProps): ReactElement {
  const { showToast } = useToast();
  const [phase, setPhase] = useState<'confirm' | 'in-use'>('confirm');
  const deleteMutation = useDeleteInventoryLocationMutation();
  const retireMutation = useUpdateInventoryLocationMutation();

  const { reset: resetDelete } = deleteMutation;
  const { reset: resetRetire } = retireMutation;
  useEffect(() => {
    if (location === null) return;
    setPhase('confirm');
    resetDelete();
    resetRetire();
  }, [location, resetDelete, resetRetire]);

  async function handleDelete(): Promise<void> {
    if (location === null) return;
    try {
      await deleteMutation.mutateAsync(location.id);
      showToast({
        tone: 'success',
        title: `"${location.name}" deleted`,
        description: 'No inventory position named it, so the row is gone rather than retired.',
      });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.isConflict()) {
        setPhase('in-use');
        return;
      }
      // Surfaced via deleteMutation.error → the dialog body below.
    }
  }

  async function handleRetire(): Promise<void> {
    if (location === null) return;
    try {
      await retireMutation.mutateAsync({ id: location.id, patch: { status: 'inactive' } });
      showToast({
        tone: 'success',
        title: `"${location.name}" retired`,
        description: 'Existing positions keep pointing at it; it can be re-activated later.',
      });
      onClose();
    } catch {
      // Surfaced via retireMutation.error → the dialog body below.
    }
  }

  const open = location !== null;
  const isInUse = phase === 'in-use';
  const genericError =
    deleteMutation.error && !(deleteMutation.error instanceof ApiError && deleteMutation.error.isConflict())
      ? deleteMutation.error
      : (retireMutation.error ?? null);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      title={isInUse ? `Can't delete "${location?.name ?? ''}"` : `Delete "${location?.name ?? ''}"?`}
      description={
        isInUse
          ? "Stock positions still point here. Retire it instead — existing history keeps pointing at a row that exists, and it can be re-activated later."
          : "This can't be undone. If stock still points here, the delete will be refused instead."
      }
      body={
        <>
          {isInUse ? (
            <Alert tone="warning" title="Stock still points here">
              The delete was refused. Retire the location instead — existing positions keep pointing at a
              row that exists.
            </Alert>
          ) : null}
          {genericError ? (
            <Alert tone="error" title="Could not save the location">
              {genericError.message}
            </Alert>
          ) : null}
        </>
      }
      // Retire is a corrective, non-destructive action — styling it danger-red
      // like the delete it replaces would be the wrong severity signal.
      tone={isInUse ? 'default' : 'danger'}
      confirmLabel={isInUse ? 'Retire instead' : 'Delete'}
      isConfirming={deleteMutation.isPending || retireMutation.isPending}
      onConfirm={() => {
        if (isInUse) {
          void handleRetire();
        } else {
          void handleDelete();
        }
      }}
    />
  );
}
