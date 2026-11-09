/**
 * Shipping step: the label defaults (#3958)
 *
 * The pure conversion between the step's parcel form and the
 * `config.autoDispatch` it saves, and the one extra rule this step adds on top
 * of a routing rule's parcel validation: the weight is required. A routing
 * rule may leave it out because the label is bought by hand and the operator
 * types the weight then; here nobody is there to type it, and a product with
 * no weight of its own would refuse the whole parcel.
 *
 * @module features/oms-onboarding/lib
 */
import {
  EMPTY_PARCEL_DRAFT,
  draftFromFields,
  draftToFields,
  isListedParcelTemplate,
  validateDraft,
  type ParcelProfileDraft,
} from '../../mappings';
import type { AutoDispatchSettings } from './config-merge';

export interface AutoDispatchDraft {
  readonly draft: ParcelProfileDraft;
  /** The size is a typed carrier code rather than one of the listed sizes. */
  readonly customTemplate: boolean;
}

/** The form's starting values: the saved defaults, or an empty form. */
export function draftFromAutoDispatch(saved: AutoDispatchSettings | null): AutoDispatchDraft {
  if (saved === null) return { draft: EMPTY_PARCEL_DRAFT, customTemplate: false };
  const draft = draftFromFields({
    parcelTemplate: saved.parcelTemplate ?? null,
    lengthMm: saved.lengthMm ?? null,
    widthMm: saved.widthMm ?? null,
    heightMm: saved.heightMm ?? null,
    defaultWeightGrams: saved.defaultWeightGrams ?? null,
  });
  return {
    draft,
    customTemplate: draft.template !== '' && !isListedParcelTemplate(draft.template),
  };
}

/**
 * First problem with the form, or `null` when it can be saved. The missing
 * weight sentence is passed in, in the caller's language, so this stays a pure
 * rule with no copy of its own.
 */
export function validateAutoDispatchDraft(
  { draft, customTemplate }: AutoDispatchDraft,
  weightRequiredMessage: string
): string | null {
  const problem = validateDraft(draft, { customTemplate });
  if (problem !== null) return problem;
  return draft.weightKg.trim() === '' ? weightRequiredMessage : null;
}

/** The settings a valid form saves, switched on. */
export function autoDispatchFromDraft(draft: ParcelProfileDraft): AutoDispatchSettings {
  const fields = draftToFields(draft);
  const box =
    fields.lengthMm !== null && fields.widthMm !== null && fields.heightMm !== null
      ? { lengthMm: fields.lengthMm, widthMm: fields.widthMm, heightMm: fields.heightMm }
      : {};
  return {
    enabled: true,
    ...(fields.parcelTemplate === null ? {} : { parcelTemplate: fields.parcelTemplate }),
    ...(fields.defaultWeightGrams === null ? {} : { defaultWeightGrams: fields.defaultWeightGrams }),
    ...box,
  };
}
