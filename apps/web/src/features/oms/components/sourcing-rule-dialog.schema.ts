/**
 * Sourcing-rule dialog schema (#3058)
 *
 * The form's own validation. Everything here is also enforced server-side
 * (#2953 validates by round-tripping through `coerceRoutingRule`) — the browser
 * is not a trust boundary, and this exists so an operator learns while typing
 * rather than from a rejected submit.
 *
 * ## `kind` is in the schema but is NOT patchable
 *
 * It is half a rule's identity under the duplicate-detection index, so
 * `UpdateSourcingRuleDto` deliberately omits it and a PATCH carrying one is
 * dropped. The dialog therefore locks the control on edit; the field stays in
 * the schema because the CREATE path needs it and because the name options are
 * derived from it in both modes.
 *
 * ## The window rule is `to > from`, strictly
 *
 * Equal bounds describe a rule that is never in force — it would save happily
 * and never fire, which is the defect this whole screen exists to make
 * impossible.
 *
 * ## `priorityLocationIds` is checked in BOTH directions
 *
 * Present on a rule that does not rank by a list is refused (the server refuses
 * it too, and clearing the list has to be acknowledged rather than silent);
 * absent on `priority` is refused because a priority rule with no list ranks
 * nothing.
 *
 * @module apps/web/src/features/oms/components
 */
import { z } from 'zod';

import {
  SOURCING_FILTER_NAME_VALUES,
  SOURCING_RULE_KIND_VALUES,
  SOURCING_SORT_NAME_VALUES,
  SOURCING_AFTER_ACTION_VALUES,
} from '../lib/sourcing-rule-vocabulary';

/** The one sort that reads an operator-ordered location list. */
export const PRIORITY_SORT_NAME = 'priority';

const NAME_VALUES = [...SOURCING_FILTER_NAME_VALUES, ...SOURCING_SORT_NAME_VALUES] as const;

export const sourcingRuleFormSchema = z
  .object({
    kind: z.enum(SOURCING_RULE_KIND_VALUES, { message: 'Choose whether this rule filters or sorts' }),
    name: z.enum(NAME_VALUES, { message: 'Choose what this rule does' }),
    afterAction: z.enum(SOURCING_AFTER_ACTION_VALUES, {
      message: 'Choose how far an order may be split',
    }),
    priorityLocationIds: z.array(z.string().min(1)),
    /** `''` means "no bound", which is what the API stores as `null`. */
    effectiveFrom: z.string(),
    effectiveTo: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.kind === 'filter' && !(SOURCING_FILTER_NAME_VALUES as readonly string[]).includes(values.name)) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'That rule sorts locations; it cannot be used as a filter' });
    }
    if (values.kind === 'sort' && !(SOURCING_SORT_NAME_VALUES as readonly string[]).includes(values.name)) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'That rule filters locations; it cannot be used as a sort' });
    }

    if (values.name === PRIORITY_SORT_NAME && values.priorityLocationIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['priorityLocationIds'],
        message: 'Add at least one location — a priority list with nothing in it ranks nothing',
      });
    }
    if (values.name !== PRIORITY_SORT_NAME && values.priorityLocationIds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['priorityLocationIds'],
        message: 'This rule does not use a location order, so the list must be empty',
      });
    }

    if (values.effectiveFrom !== '' && values.effectiveTo !== '' && values.effectiveTo <= values.effectiveFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveTo'],
        message: 'The end date must be after the start date — otherwise this rule would never run',
      });
    }
  });

export type SourcingRuleFormValues = z.input<typeof sourcingRuleFormSchema>;
export type SourcingRuleFormSubmission = z.output<typeof sourcingRuleFormSchema>;

/**
 * A date input's `YYYY-MM-DD` as an instant the API accepts, or `null` for an
 * unset bound.
 *
 * Midnight UTC, deliberately: a bare date has no zone, and taking the
 * browser's would make the same form produce a different stored instant for two
 * operators in different offices.
 */
export function toEffectiveInstant(value: string): string | null {
  return value === '' ? null : new Date(`${value}T00:00:00.000Z`).toISOString();
}

/** The inverse, for populating the form from a stored rule. */
export function toDateInputValue(iso: string | null): string {
  if (iso === null) return '';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}
