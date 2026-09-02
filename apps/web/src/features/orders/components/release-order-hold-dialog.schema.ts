/**
 * Release-hold dialog Zod schema (#2342)
 *
 * The note is **conditionally** required, and the condition is not something a
 * static schema can know: the backend requires one when a USER releases a
 * SERVICE-placed hold, and allows a note-less release of a user-placed one.
 * Declaring it unconditionally required would refuse a submit the API accepts;
 * declaring it optional would let the operator hit a 400 they could have been
 * told about before typing.
 *
 * So the schema is BUILT PER OPEN from the hold being released — the dialog
 * already knows the placer, because `activeHold.placedByService` is on the
 * detail projection. Whitespace-only text does not satisfy the requirement,
 * matching the service, which normalises empty/whitespace to null before it
 * applies the rule.
 *
 * @module apps/web/src/features/orders/components
 */
import { z } from 'zod';

import { HOLD_NOTE_MAX_LENGTH } from './place-order-hold-dialog.schema';

export interface ReleaseOrderHoldFormValues {
  note?: string;
}

/**
 * @param noteRequired `true` when the hold was placed by a service, so a user
 *   releasing it must say why. Resolve it from `hold.placedByService !== null`.
 */
export function buildReleaseOrderHoldSchema(noteRequired: boolean) {
  const note = z
    .string()
    .max(HOLD_NOTE_MAX_LENGTH, `Keep the note under ${HOLD_NOTE_MAX_LENGTH} characters`)
    .optional();

  return z.object({
    note: noteRequired
      ? note.refine((value) => (value ?? '').trim().length > 0, {
          message: 'A note is required to release a hold OpenLinker placed automatically',
        })
      : note,
  });
}
