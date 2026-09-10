/**
 * Location dialog Zod schema (#2316 / #3067)
 *
 * Covers every `CreateLocationDto` field. Native form controls always bind
 * strings, so the optional/nullable backend fields (`ownerConnectionId`,
 * `externalRef`, `countryIso2`, `postcode`, `latitude`, `longitude`) are
 * modelled as `''` meaning "not set" and mapped to `null` in `toCreateInput` /
 * `toUpdateInput` — the `generate-label-form.schema.ts` precedent for an
 * optional-amount field.
 *
 * `code` is validated here (create) but the dialog omits the field entirely
 * on edit per the PATCH contract (`UpdateLocationDto` has no `code` — see its
 * own docblock: renaming the natural key is not a patch-shaped operation).
 *
 * @module apps/web/src/features/inventory/components
 */
import { z } from 'zod';
import type {
  CreateInventoryLocationInput,
  InventoryLocationKind,
  UpdateInventoryLocationInput,
} from '../api/inventory-locations.types';
import { InventoryLocationKindValues } from '../api/inventory-locations.types';

const latLngField = z.union([
  z.literal(''),
  z.coerce.number().min(-90, 'Must be between -90 and 90').max(90, 'Must be between -90 and 90'),
]);

const lngField = z.union([
  z.literal(''),
  z.coerce.number().min(-180, 'Must be between -180 and 180').max(180, 'Must be between -180 and 180'),
]);

export const locationDialogSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(64, 'Code must be 64 characters or fewer'),
  name: z.string().trim().min(1, 'Name is required').max(255, 'Name must be 255 characters or fewer'),
  kind: z.enum(InventoryLocationKindValues),
  // '' = none. A real select value is a connection id, never validated as a
  // UUID here — the backend's own @IsUUID / LocationOwnerConnectionNotFoundError
  // (422) is the source of truth for whether it names a real connection.
  ownerConnectionId: z.string(),
  externalRef: z.string().trim().max(255, 'Must be 255 characters or fewer'),
  countryIso2: z.union([
    z.literal(''),
    z.string().trim().length(2, 'Use a 2-letter country code (ISO-3166-1 alpha-2)'),
  ]),
  postcode: z.string().trim().max(16, 'Must be 16 characters or fewer'),
  latitude: latLngField,
  longitude: lngField,
});

// Two derived types (the `generate-label-form.schema.ts` shape): `Values` is
// what RHF binds to, `Submission` is the resolved post-coercion shape the
// submit handler sees (z.coerce turns the union's number branch into `number`).
export type LocationDialogFormValues = z.input<typeof locationDialogSchema>;
export type LocationDialogFormSubmission = z.output<typeof locationDialogSchema>;

export const LOCATION_DIALOG_DEFAULT_VALUES: LocationDialogFormValues = {
  code: '',
  name: '',
  kind: 'warehouse',
  ownerConnectionId: '',
  externalRef: '',
  countryIso2: '',
  postcode: '',
  latitude: '',
  longitude: '',
};

export const KIND_LABEL: Record<InventoryLocationKind, string> = {
  warehouse: 'Warehouse',
  store: 'Store',
  'third-party': 'Third-party',
  virtual: 'Virtual',
};

export function toCreateInput(values: LocationDialogFormSubmission): CreateInventoryLocationInput {
  return {
    code: values.code.toUpperCase(),
    name: values.name,
    kind: values.kind,
    ownerConnectionId: values.ownerConnectionId === '' ? null : values.ownerConnectionId,
    externalRef: values.externalRef === '' ? null : values.externalRef,
    countryIso2: values.countryIso2 === '' ? null : values.countryIso2.toUpperCase(),
    postcode: values.postcode === '' ? null : values.postcode,
    latitude: values.latitude === '' ? null : values.latitude,
    longitude: values.longitude === '' ? null : values.longitude,
  };
}

/** Same mapping, minus `code` — `UpdateLocationDto` does not accept it. */
export function toUpdateInput(values: LocationDialogFormSubmission): UpdateInventoryLocationInput {
  return {
    name: values.name,
    kind: values.kind,
    ownerConnectionId: values.ownerConnectionId === '' ? null : values.ownerConnectionId,
    externalRef: values.externalRef === '' ? null : values.externalRef,
    countryIso2: values.countryIso2 === '' ? null : values.countryIso2.toUpperCase(),
    postcode: values.postcode === '' ? null : values.postcode,
    latitude: values.latitude === '' ? null : values.latitude,
    longitude: values.longitude === '' ? null : values.longitude,
  };
}
