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
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { useToast } from '../../../shared/ui/toast-provider';
import { ApiError, isUnmappedApiError } from '../../../shared/api/api-error';
import { useDeleteInventoryLocationMutation } from '../hooks/use-delete-inventory-location-mutation';
import { useUpdateInventoryLocationMutation } from '../hooks/use-update-inventory-location-mutation';
import type { InventoryLocation } from '../api/inventory-locations.types';

interface LocationDeleteDialogProps {
  location: InventoryLocation | null;
  onClose: () => void;
}

export function LocationDeleteDialog({ location, onClose }: LocationDeleteDialogProps): ReactElement {
  const copy = useMessages('inventory').locationDeleteDialog;
  const { showToast } = useToast();
  const [phase, setPhase] = useState<'confirm' | 'in-use'>('confirm');
  const deleteMutation = useDeleteInventoryLocationMutation();
  const retireMutation = useUpdateInventoryLocationMutation();

  const { reset: resetDelete } = deleteMutation;
  const { reset: resetRetire } = retireMutation;
  const locationId = location?.id ?? null;
  useEffect(() => {
    if (locationId === null) return;
    setPhase('confirm');
    resetDelete();
    resetRetire();
    // Keyed on the id, not the `location` object's identity: unlike
    // `LocationDialog`'s `target` (a fresh wrapper minted at open-time),
    // `location` here is the row itself. A future caller that derives it
    // reactively off refetched query data (`locations.find(...)`) would
    // otherwise hand this effect a new-but-equal object on every refetch and
    // silently reset an in-flight `in-use`/retire decision back to plain
    // "Delete?" mid-flow. #3068 tech-review.
  }, [locationId, resetDelete, resetRetire]);

  async function handleDelete(): Promise<void> {
    if (location === null) return;
    try {
      await deleteMutation.mutateAsync(location.id);
      showToast({
        tone: 'success',
        title: interpolate(copy.deletedTitle, { name: location.name }),
        description: copy.deletedDescription,
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
        title: interpolate(copy.retiredTitle, { name: location.name }),
        // #3068 dropped "can be re-activated later" because nothing in the
        // product exposed it then. #3066 ships the Reactivate row action, so
        // the clause is true again - and it is the mockup's own sentence
        // (`inventory-locations-3063.html:795`), which is also the stated
        // reason retiring needs no confirm step. #3198 review.
        description: copy.retiredDescription,
      });
      onClose();
    } catch {
      // Surfaced via retireMutation.error → the dialog body below.
    }
  }

  const open = location !== null;
  const isInUse = phase === 'in-use';
  const genericError =
    deleteMutation.error && isUnmappedApiError(deleteMutation.error, (e) => e.isConflict())
      ? deleteMutation.error
      : (retireMutation.error ?? null);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      title={interpolate(isInUse ? copy.titleInUse : copy.titleConfirm, { name: location?.name ?? '' })}
      description={isInUse ? copy.descriptionInUse : copy.descriptionConfirm}
      body={
        <>
          {/* Distinct from `description` above on purpose — the description
              says WHY delete was refused, this says what retiring actually
              does, so the two don't restate the same fact (#3068
              tech-review). Carries the reversibility clause for the same
              reason the success toast above does - see that note. */}
          {isInUse ? (
            <Alert tone="warning" title={copy.retireInsteadTitle}>
              {copy.retireInsteadBody}
            </Alert>
          ) : null}
          {genericError ? (
            <Alert tone="error" title={copy.saveError}>
              {genericError.message}
            </Alert>
          ) : null}
        </>
      }
      // Retire is a corrective, non-destructive action — styling it danger-red
      // like the delete it replaces would be the wrong severity signal.
      tone={isInUse ? 'default' : 'danger'}
      confirmLabel={isInUse ? copy.retireInstead : copy.delete}
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
