/**
 * Promotion form state (#3935)
 *
 * The one `react-hook-form` instance the detail page and the new-promotion page
 * share, and everything derived from it: the problems, the write body, which
 * problems to draw (none until the operator tried to save), the name suggestion
 * offered beside the name field, and the reset that
 * applies a saved promotion without wiping what was typed on a refetch.
 *
 * @module apps/web/src/features/promotions/lib
 */
import { useEffect, useRef, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import {
  formToWriteInput,
  validatePromotionForm,
  type PromotionFormProblem,
  type PromotionFormValues,
} from './promotion-form';
import type { PromotionWriteInput } from '../api/promotions.types';

export interface PromotionFormState {
  form: UseFormReturn<PromotionFormValues>;
  values: PromotionFormValues;
  problems: PromotionFormProblem[];
  /** The form as a write body (switched on), or `null` while something is missing. */
  draft: PromotionWriteInput | null;
  /** What the form draws as invalid right now. */
  invalid: ReadonlySet<PromotionFormProblem>;
  nameTouched: boolean;
  /** A suggested name for the current values; `''` while there is none. */
  suggestion: string;
  markNameTyped: () => void;
  /** The operator tried to save: every problem is drawn from now on. */
  attempt: () => void;
}

export function usePromotionFormState(options: {
  initial: PromotionFormValues;
  /** Changes when a different promotion (or a newer save of it) is being edited. */
  editedKey: string;
  /** The suggested name for the current values; `''` while there is none. */
  suggest: (values: PromotionFormValues) => string;
}): PromotionFormState {
  const { initial, editedKey, suggest } = options;
  const form = useForm<PromotionFormValues>({ defaultValues: initial });
  const values = form.watch();
  const [nameTouched, setNameTouched] = useState(initial.name !== '');
  const [attempted, setAttempted] = useState(false);

  // Reset only when the thing being edited changes, or when the starting values
  // changed under a form the operator has not touched (product names arriving
  // late). A failed save, a refetch or a re-render with the same content must
  // never wipe typed values.
  const { reset, getValues } = form;
  const initialKey = JSON.stringify(initial);
  const lastEditedKey = useRef(editedKey);
  const appliedKey = useRef<string | null>(null);
  useEffect(() => {
    const switched = lastEditedKey.current !== editedKey;
    lastEditedKey.current = editedKey;
    const touched = appliedKey.current !== null && JSON.stringify(getValues()) !== appliedKey.current;
    if (!switched && touched) return;
    appliedKey.current = initialKey;
    reset(initial);
    setNameTouched(initial.name !== '');
    setAttempted(false);
  }, [editedKey, initialKey, reset, getValues, initial]);

  const problems = validatePromotionForm(values);
  const draft = problems.length === 0 ? formToWriteInput(values, true) : null;

  // A hint only: the new page offers it beside the name field with a Use link.
  const suggestion = suggest(values);

  const invalid = new Set<PromotionFormProblem>(attempted ? problems : []);
  if (nameTouched && values.name.trim() === '') invalid.add('name');

  return {
    form,
    values,
    problems,
    draft,
    invalid,
    nameTouched,
    suggestion,
    markNameTyped: (): void => {
      setNameTouched(true);
    },
    attempt: (): void => {
      setAttempted(true);
    },
  };
}

/** Moves to the first field the form draws as invalid; a no-op while none is. */
export function focusFirstInvalid(root: ParentNode | null): void {
  requestAnimationFrame(() => {
    const field = root?.querySelector<HTMLElement>('.form-field.is-invalid, .pm-picker.is-invalid');
    if (!field) return;
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    field.querySelector<HTMLElement>('input, select, button')?.focus({ preventScroll: true });
  });
}
