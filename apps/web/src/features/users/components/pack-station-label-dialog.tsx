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
import { useEffect, useMemo, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { describeApiError } from '../../../shared/api/describe-api-error';
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
import { interpolate, useMessages } from '../../../shared/i18n';
import { useUpdatePackStationLabelMutation } from '../hooks/use-update-pack-station-label-mutation';
import { PACK_STATION_LABEL_MAX_LENGTH } from '../api/users.types';
import type { UserSummary } from '../api/users.types';
import {
  createPackStationLabelDialogSchema,
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
  const copy = useMessages('users').packStation;
  const schema = useMemo(
    () =>
      createPackStationLabelDialogSchema(
        interpolate(copy.maxLength, { max: PACK_STATION_LABEL_MAX_LENGTH })
      ),
    [copy]
  );

  const form = useForm<
    PackStationLabelFormValues,
    undefined,
    PackStationLabelFormSubmission
  >({
    defaultValues: { packStationLabel: '' },
    resolver: zodResolver(schema),
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
        title: copy.updated,
        description: interpolate(
          toUpdateInput(values).packStationLabel === null ? copy.cleared : copy.saved,
          { username: target.username }
        ),
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
          {target === null
            ? copy.title
            : interpolate(copy.titleFor, { username: target.username })}
        </DialogTitle>
        <DialogDescription>
          {copy.description}
        </DialogDescription>

        {mutation.error ? (
          <Alert tone="error" title={copy.saveFailed}>
            {describeApiError(mutation.error, 'users')}
          </Alert>
        ) : null}

        <form
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          noValidate
        >
          <FormField
            label={copy.label}
            name="packStationLabel"
            error={form.formState.errors.packStationLabel?.message}
            description={copy.hint}
          >
            <Input
              placeholder={copy.placeholder}
              maxLength={PACK_STATION_LABEL_MAX_LENGTH}
              {...form.register('packStationLabel')}
            />
          </FormField>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="ghost">
                {copy.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? copy.submitting : copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
