/**
 * Pack Station Label dialog Zod schema (#3404)
 *
 * A single free-text field. Native form controls always bind strings, so
 * "unset" is modelled as `''` in form state and mapped to `null` on submit —
 * the same `location-dialog.schema.ts` shape used for every other
 * optional/nullable field in this app. A blank string is a valid CLEAR, not
 * an omission: `UpdatePackStationLabelDto` distinguishes "send null" from
 * "send nothing" (see its own docblock), and this form always sends one or
 * the other.
 *
 * @module apps/web/src/features/users/components
 */
import { z } from 'zod';
import { PACK_STATION_LABEL_MAX_LENGTH } from '../api/users.types';
import type { UpdatePackStationLabelInput } from '../api/users.types';

/** Built with the `users.packStation.maxLength` message in the active language. */
export function createPackStationLabelDialogSchema(maxLengthMessage: string) {
  return z.object({
    packStationLabel: z.string().trim().max(PACK_STATION_LABEL_MAX_LENGTH, maxLengthMessage),
  });
}

export type PackStationLabelFormValues = z.input<ReturnType<typeof createPackStationLabelDialogSchema>>;
export type PackStationLabelFormSubmission = z.output<ReturnType<typeof createPackStationLabelDialogSchema>>;

export function toFormValues(currentLabel: string | null): PackStationLabelFormValues {
  return { packStationLabel: currentLabel ?? '' };
}

export function toUpdateInput(
  values: PackStationLabelFormSubmission,
): UpdatePackStationLabelInput {
  return { packStationLabel: values.packStationLabel === '' ? null : values.packStationLabel };
}
