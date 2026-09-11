/**
 * Location Dialog — create/edit form for `inventory_locations` (#2316 / #3067)
 *
 * `target` follows the `AiProviderKeyDialog` shape: `null` closes the
 * dialog; a value opens it, pinned to either a fresh create or one existing
 * row. Switching `target` (e.g. clicking Edit on a different row while this
 * dialog is already open) resets the form and any prior mutation error, so
 * an operator editing several rows back-to-back never sees a stale value.
 *
 * `code` is rendered only on CREATE — `UpdateLocationDto` has no `code` field
 * (it's the row's natural key), so the edit form must not offer to change it
 * rather than silently dropping an edited value on submit.
 *
 * @module apps/web/src/features/inventory/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, type ReactElement } from 'react';
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
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import { usePlatforms } from '../../../shared/plugins';
import { ApiError } from '../../../shared/api/api-error';
import { resolvePlatformLabel } from '../../mappings';
import { useConnectionsQuery } from '../../connections';
import { useCreateInventoryLocationMutation } from '../hooks/use-create-inventory-location-mutation';
import { useUpdateInventoryLocationMutation } from '../hooks/use-update-inventory-location-mutation';
import type { InventoryLocation } from '../api/inventory-locations.types';
import { InventoryLocationKindValues } from '../api/inventory-locations.types';
import {
  KIND_LABEL,
  LOCATION_DIALOG_DEFAULT_VALUES,
  locationDialogSchema,
  toCreateInput,
  toUpdateInput,
  type LocationDialogFormSubmission,
  type LocationDialogFormValues,
} from './location-dialog.schema';

export type LocationDialogTarget = { mode: 'create' } | { mode: 'edit'; location: InventoryLocation };

interface LocationDialogProps {
  target: LocationDialogTarget | null;
  onClose: () => void;
}

function toFormValues(location: InventoryLocation): LocationDialogFormValues {
  return {
    code: location.code,
    name: location.name,
    kind: location.kind,
    ownerConnectionId: location.ownerConnectionId ?? '',
    externalRef: location.externalRef ?? '',
    countryIso2: location.countryIso2 ?? '',
    postcode: location.postcode ?? '',
    latitude: location.latitude ?? '',
    longitude: location.longitude ?? '',
  };
}

export function LocationDialog({ target, onClose }: LocationDialogProps): ReactElement {
  const { showToast } = useToast();
  const platforms = usePlatforms();
  const connectionsQuery = useConnectionsQuery();
  const createMutation = useCreateInventoryLocationMutation();
  const updateMutation = useUpdateInventoryLocationMutation();

  const isEdit = target?.mode === 'edit';
  const mutation = isEdit ? updateMutation : createMutation;

  const form = useForm<LocationDialogFormValues, undefined, LocationDialogFormSubmission>({
    defaultValues: LOCATION_DIALOG_DEFAULT_VALUES,
    resolver: zodResolver(locationDialogSchema),
  });

  const { reset: resetForm } = form;
  const { reset: resetCreate } = createMutation;
  const { reset: resetUpdate } = updateMutation;
  useEffect(() => {
    if (target === null) return;
    resetForm(target.mode === 'edit' ? toFormValues(target.location) : LOCATION_DIALOG_DEFAULT_VALUES);
    resetCreate();
    resetUpdate();
    // `target` is a fresh object identity on every open (including a
    // create-then-immediately-create-again click), so it — not its nested
    // fields — is the right dependency for "the dialog just opened".
  }, [target, resetForm, resetCreate, resetUpdate]);

  // Active connections only — "whose sync may write stock here" (the
  // field's own description) is misleading for a connection that currently
  // can't sync (tech-review finding). The row's CURRENT owner, if any, is
  // kept even when inactive so editing doesn't silently blank a value the
  // select would otherwise have no matching <option> for.
  const currentOwnerId = target?.mode === 'edit' ? target.location.ownerConnectionId : null;
  const connectionOptions = useMemo(
    () =>
      (connectionsQuery.data ?? [])
        .filter((connection) => connection.status === 'active' || connection.id === currentOwnerId)
        .map((connection) => ({
          id: connection.id,
          label: `${resolvePlatformLabel(platforms, connection.platformType)} — ${connection.name}`,
        })),
    [connectionsQuery.data, platforms, currentOwnerId],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (target?.mode === 'edit') {
        await updateMutation.mutateAsync({ id: target.location.id, patch: toUpdateInput(values) });
        showToast({ tone: 'success', title: 'Location updated', description: `"${values.name}" was saved.` });
      } else {
        await createMutation.mutateAsync(toCreateInput(values));
        showToast({ tone: 'success', title: 'Location created', description: `"${values.name}" was added.` });
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.isConflict()) {
        // DuplicateLocationCodeError → 409. Only reachable on create — the
        // edit form never sends `code`.
        form.setError('code', { message: error.message });
        return;
      }
      if (error instanceof ApiError && error.status === 422) {
        // LocationOwnerConnectionNotFoundError → 422, in practice unreachable
        // through the select (it's populated from real connections) but
        // handled for a stale cache / direct-edit race.
        form.setError('ownerConnectionId', { message: error.message });
        return;
      }
      // Surfaced via mutation.error → <Alert> below.
    }
  });

  const validationMessages = Object.values(form.formState.errors)
    .map((entry) => entry?.message)
    .filter((message): message is string => typeof message === 'string');
  const showValidationSummary = form.formState.submitCount > 0 && validationMessages.length > 0;

  const open = target !== null;
  const title = isEdit ? `Edit "${target.location.name}"` : 'Add location';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          The warehouses, stores and third-party sites OpenLinker can source stock from.
        </DialogDescription>

        {mutation.error && !(mutation.error instanceof ApiError && (mutation.error.isConflict() || mutation.error.status === 422)) ? (
          <Alert tone="error" title="Could not save the location">
            {mutation.error.message}
          </Alert>
        ) : null}

        <form onSubmit={(event) => { void onSubmit(event); }} noValidate>
          {showValidationSummary ? <FormErrorSummary errors={validationMessages} /> : null}

          <div className="form-field-row">
            {isEdit ? null : (
              <FormField
                label="Code"
                name="code"
                error={form.formState.errors.code?.message}
                description="Unique across the install. Normalised to uppercase on save."
              >
                <Input placeholder="WH1" maxLength={64} {...form.register('code')} />
              </FormField>
            )}
            <FormField label="Name" name="name" error={form.formState.errors.name?.message}>
              <Input placeholder="Main warehouse" maxLength={255} {...form.register('name')} />
            </FormField>
          </div>

          <div className="form-field-row">
            <FormField label="Kind" name="kind" error={form.formState.errors.kind?.message}>
              <Select {...form.register('kind')}>
                {InventoryLocationKindValues.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Owning connection (optional)"
              name="ownerConnectionId"
              error={form.formState.errors.ownerConnectionId?.message}
              description="Whose sync may write stock here. Not authority over the location."
            >
              <Select {...form.register('ownerConnectionId')}>
                <option value="">— none —</option>
                {connectionOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <div className="form-field-row">
            <FormField
              label="Country (optional)"
              name="countryIso2"
              error={form.formState.errors.countryIso2?.message}
            >
              <Input placeholder="PL" maxLength={2} style={{ textTransform: 'uppercase' }} {...form.register('countryIso2')} />
            </FormField>
            <FormField
              label="Postcode (optional)"
              name="postcode"
              error={form.formState.errors.postcode?.message}
            >
              <Input placeholder="00-001" maxLength={16} {...form.register('postcode')} />
            </FormField>
          </div>

          <div className="form-field-row">
            <FormField
              label="Latitude (optional)"
              name="latitude"
              error={form.formState.errors.latitude?.message}
            >
              <Input type="number" step="0.0001" min={-90} max={90} {...form.register('latitude')} />
            </FormField>
            <FormField
              label="Longitude (optional)"
              name="longitude"
              error={form.formState.errors.longitude?.message}
            >
              <Input type="number" step="0.0001" min={-180} max={180} {...form.register('longitude')} />
            </FormField>
          </div>

          <FormField
            label="Operator reference (optional)"
            name="externalRef"
            error={form.formState.errors.externalRef?.message}
            description="Not an identifier mapping — nothing external reads this."
          >
            <Input placeholder="Free text — e.g. an internal warehouse code" maxLength={255} {...form.register('externalRef')} />
          </FormField>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save location'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
