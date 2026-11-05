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

import type { HoldValidationCopy } from './order-form.types';
import { HOLD_NOTE_MAX_LENGTH, holdNoteTooLongMessage } from './place-order-hold-dialog.schema';

/**
 * @param noteRequired `true` when the hold was placed by a service, so a user
 *   releasing it must say why. Resolve it from `hold.placedByService !== null`.
 * @param copy The `orders.holds.validation` copy for the active language.
 */
export function buildReleaseOrderHoldSchema(noteRequired: boolean, copy: HoldValidationCopy) {
  const note = z.string().max(HOLD_NOTE_MAX_LENGTH, holdNoteTooLongMessage(copy)).optional();

  return z.object({
    note: noteRequired
      ? note.refine((value) => (value ?? '').trim().length > 0, {
          message: copy.releaseNoteRequired,
        })
      : note,
  });
}
