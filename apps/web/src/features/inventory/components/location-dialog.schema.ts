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
import { getMessages } from '../../../shared/i18n';
import type {
  CreateInventoryLocationInput,
  InventoryLocationKind,
  InventoryLocationStatus,
  UpdateInventoryLocationInput,
} from '../api/inventory-locations.types';
import {
  InventoryLocationKindValues,
  InventoryLocationStatusValues,
  normalizeCountryIso2,
} from '../api/inventory-locations.types';

type LocationDialogCopy = ReturnType<typeof getMessages<'inventory'>>['locationDialog'];

export function createLocationDialogSchema(copy: LocationDialogCopy) {
  const errors = copy.errors;
  const latField = z.union([
    z.literal(''),
    z.coerce
      .number()
      // A non-numeric input coerces to `NaN`, which the plain min/max chain
      // would then fail with a misleading range message - this named check
      // runs first so a non-number gets a message about being a number
      // (tech-review finding).
      .refine(Number.isFinite, errors.mustBeNumber)
      .refine((value) => value >= -90 && value <= 90, errors.latRange),
  ]);

  const lngField = z.union([
    z.literal(''),
    z.coerce
      .number()
      .refine(Number.isFinite, errors.mustBeNumber)
      .refine((value) => value >= -180 && value <= 180, errors.lngRange),
  ]);

  return z.object({
    code: z.string().trim().min(1, errors.codeRequired).max(64, errors.codeTooLong),
    name: z.string().trim().min(1, errors.nameRequired).max(255, errors.nameTooLong),
    kind: z.enum(InventoryLocationKindValues),
    // Present in form state on both create and edit, but only ever RENDERED on
    // edit (mockup: `locStatusRow` ships `hidden` and is revealed only by
    // `openEdit`) - a freshly created location is always active, so the field
    // stays at its default and `toCreateInput` never sends it.
    status: z.enum(InventoryLocationStatusValues),
    // '' = none. A real select value is a connection id, never validated as a
    // UUID here - the backend's own @IsUUID / LocationOwnerConnectionNotFoundError
    // (422) is the source of truth for whether it names a real connection.
    ownerConnectionId: z.string(),
    externalRef: z.string().trim().max(255, errors.tooLong255),
    countryIso2: z.union([z.literal(''), z.string().trim().length(2, errors.countryCode)]),
    postcode: z.string().trim().max(16, errors.tooLong16),
    latitude: latField,
    longitude: lngField,
  });
}

type LocationDialogSchema = ReturnType<typeof createLocationDialogSchema>;

// Two derived types (the `generate-label-form.schema.ts` shape): `Values` is
// what RHF binds to, `Submission` is the resolved post-coercion shape the
// submit handler sees (z.coerce turns the union's number branch into `number`).
export type LocationDialogFormValues = z.input<LocationDialogSchema>;
export type LocationDialogFormSubmission = z.output<LocationDialogSchema>;

export const LOCATION_DIALOG_DEFAULT_VALUES: LocationDialogFormValues = {
  code: '',
  name: '',
  kind: 'warehouse',
  status: 'active',
  ownerConnectionId: '',
  externalRef: '',
  countryIso2: '',
  postcode: '',
  latitude: '',
  longitude: '',
};

/** Read through getters, so each read uses the active language. */
export const KIND_LABEL: Readonly<Record<InventoryLocationKind, string>> = {
  get warehouse(): string {
    return getMessages('inventory').locationDialog.kinds.warehouse;
  },
  get store(): string {
    return getMessages('inventory').locationDialog.kinds.store;
  },
  get 'third-party'(): string {
    return getMessages('inventory').locationDialog.kinds.thirdParty;
  },
  get virtual(): string {
    return getMessages('inventory').locationDialog.kinds.virtual;
  },
};

/** Mockup's `locStatus` `<select>` option labels - Edit-only field. */
export const STATUS_OPTION_LABEL: Readonly<Record<InventoryLocationStatus, string>> = {
  get active(): string {
    return getMessages('inventory').locationDialog.statuses.active;
  },
  get inactive(): string {
    return getMessages('inventory').locationDialog.statuses.inactive;
  },
};

// `status` is deliberately OMITTED — the field is invisible on create (the
// mockup ships `locStatusRow` `hidden` there), so a freshly created location
// is always the backend's own default, never a value this form asserted.
export function toCreateInput(values: LocationDialogFormSubmission): CreateInventoryLocationInput {
  return {
    code: values.code.toUpperCase(),
    name: values.name,
    kind: values.kind,
    ownerConnectionId: values.ownerConnectionId === '' ? null : values.ownerConnectionId,
    externalRef: values.externalRef === '' ? null : values.externalRef,
    countryIso2: values.countryIso2 === '' ? null : normalizeCountryIso2(values.countryIso2),
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
    status: values.status,
    ownerConnectionId: values.ownerConnectionId === '' ? null : values.ownerConnectionId,
    externalRef: values.externalRef === '' ? null : values.externalRef,
    countryIso2: values.countryIso2 === '' ? null : normalizeCountryIso2(values.countryIso2),
    postcode: values.postcode === '' ? null : values.postcode,
    latitude: values.latitude === '' ? null : values.latitude,
    longitude: values.longitude === '' ? null : values.longitude,
  };
}
