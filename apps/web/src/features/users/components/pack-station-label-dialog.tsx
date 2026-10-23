/**
 * Pack Station Label Dialog (#3404)
 *
 * Lets an admin set or clear a user's bench/printer label — the write side
 * of what the pack bench itself now reads and displays (`bench-documents.tsx`).
 * Follows the `LocationDialog` shape: `target` follows the
 * `AiProviderKeyDialog` convention — `null` closes the dialog, a value opens
 * it pinned to one user, and switching `target` resets the form and any
 * prior mutation error.
 *
 * A shared bench is configured by whoever set it up, not by whichever
 * packer is currently standing at it — so this is an admin-only affordance,
 * matching the backend route's own `@Roles('admin')` guard, rather than a
 * self-service control on the packer's own account.
 *
 * @module apps/web/src/features/users/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';
import { useUpdatePackStationLabelMutation } from '../hooks/use-update-pack-station-label-mutation';
import { PACK_STATION_LABEL_MAX_LENGTH } from '../api/users.types';
import type { UserSummary } from '../api/users.types';
import {
  packStationLabelDialogSchema,
  toFormValues,
  toUpdateInput,
  type PackStationLabelFormSubmission,
  type PackStationLabelFormValues,
} from './pack-station-label-dialog.schema';

export interface PackStationLabelDialogProps {
  /** `null` closes the dialog; a user opens it, pinned to that user. */
  target: UserSummary | null;
  onClose: () => void;
}

export function PackStationLabelDialog({
  target,
  onClose,
}: PackStationLabelDialogProps): ReactElement {
  const { showToast } = useToast();
  const mutation = useUpdatePackStationLabelMutation();

  const form = useForm<
    PackStationLabelFormValues,
    undefined,
    PackStationLabelFormSubmission
  >({
    defaultValues: { packStationLabel: '' },
    resolver: zodResolver(packStationLabelDialogSchema),
  });

  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (target === null) return;
    resetForm(toFormValues(target.packStationLabel));
    resetMutation();
    // `target` is a fresh object identity on every open — the right
    // dependency for "the dialog just opened" (the `LocationDialog` shape).
  }, [target, resetForm, resetMutation]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (target === null) return;
    try {
      await mutation.mutateAsync({ userId: target.id, ...toUpdateInput(values) });
      showToast({
        tone: 'success',
        title: 'Pack station label updated',
        description:
          toUpdateInput(values).packStationLabel === null
            ? `Cleared for ${target.username}.`
            : `Saved for ${target.username}.`,
      });
      onClose();
    } catch {
      // Surfaced via mutation.error → <Alert> below.
    }
  });

  const open = target !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>
          {target === null ? 'Pack station label' : `Pack station label for ${target.username}`}
        </DialogTitle>
        <DialogDescription>
          Shown to this packer at the bench, e.g. "Zebra ZD420 / Bench 3". Operator
          configuration only — it carries no login weight and identifies nobody.
        </DialogDescription>

        {mutation.error ? (
          <Alert tone="error" title="Could not save the label">
            {mutation.error.message}
          </Alert>
        ) : null}

        <form
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          noValidate
        >
          <FormField
            label="Label"
            name="packStationLabel"
            error={form.formState.errors.packStationLabel?.message}
            description="Leave blank to clear it."
          >
            <Input
              placeholder="Zebra ZD420 / Bench 3"
              maxLength={PACK_STATION_LABEL_MAX_LENGTH}
              {...form.register('packStationLabel')}
            />
          </FormField>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save label'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
