/**
 * KSeF numbering editor (#1577)
 *
 * Two-column editing surface: the form on the left, the sticky live-preview
 * panel on the right. Handles both flows:
 *   - setup: create the main series + (optionally) a separate correction series,
 *     then assign both to the connection.
 *   - edit: patch a single existing series (main or correction).
 *
 * Validation mirrors the C1 rule for instant UX feedback, but the API stays the
 * source of truth — the server's 400 `errors[]` are surfaced verbatim on
 * submit. Lowering the next number is allowed but warned (a migration case).
 *
 * @module plugins/ksef/components
 */
import { useRef, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  useCreateNumberingSeriesMutation,
  useSetNumberingAssignmentMutation,
  useUpdateNumberingSeriesMutation,
  type NumberingSeries,
  type ResetPolicy,
} from '../../../features/invoicing';
import { ResetPolicyValues } from '../../../features/invoicing';
import { ApiError } from '../../../shared/api/api-error';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Chip } from '../../../shared/ui/chip';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import { KsefNumberingPreview } from './ksef-numbering-preview';
import {
  NUMBERING_SETUP_DEFAULTS,
  NUMBERING_VARIABLE_CHIPS,
  RESET_POLICY_LABELS,
  numberingFormSchema,
  seriesToFormValues,
  toCorrectionCreateInput,
  toMainCreateInput,
  toSeriesUpdateInput,
  type NumberingFormValues,
} from './ksef-numbering.schema';

interface KsefNumberingEditorProps {
  connectionId: string;
  mode: 'setup' | 'edit';
  /** Which series is being edited (labels/copy only); ignored in setup. */
  seriesLabel?: 'main' | 'correction';
  /** The series being edited (edit mode only). */
  series?: NumberingSeries;
  onDone: () => void;
  onCancel: () => void;
}

/** Pull the domain validator's flat issue list off a 400 response, if present. */
function extractServerIssues(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.status !== 400) return [];
  const details = error.details;
  if (typeof details === 'object' && details !== null && 'errors' in details) {
    const errors = (details as { errors?: unknown }).errors;
    if (Array.isArray(errors)) return errors.filter((e): e is string => typeof e === 'string');
  }
  return [];
}

export function KsefNumberingEditor({
  connectionId,
  mode,
  seriesLabel = 'main',
  series,
  onDone,
  onCancel,
}: KsefNumberingEditorProps): ReactElement {
  const { showToast } = useToast();
  const createSeries = useCreateNumberingSeriesMutation();
  const updateSeries = useUpdateNumberingSeriesMutation();
  const setAssignment = useSetNumberingAssignmentMutation();
  const patternInputRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<NumberingFormValues>({
    defaultValues:
      mode === 'edit' && series ? seriesToFormValues(series) : NUMBERING_SETUP_DEFAULTS,
    resolver: zodResolver(numberingFormSchema),
    mode: 'onChange',
  });

  const values = form.watch();
  const { errors } = form.formState;

  const patternRegister = form.register('pattern');

  function insertVariable(variable: string): void {
    const input = patternInputRef.current;
    const current = form.getValues('pattern');
    if (!input) {
      form.setValue('pattern', `${current}${variable}`, { shouldDirty: true, shouldValidate: true });
      return;
    }
    const start = input.selectionStart ?? current.length;
    const end = input.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${variable}${current.slice(end)}`;
    form.setValue('pattern', next, { shouldDirty: true, shouldValidate: true });
    // Restore the caret just after the inserted token on the next tick.
    requestAnimationFrame(() => {
      const caret = start + variable.length;
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  }

  const isPending = createSeries.isPending || updateSeries.isPending || setAssignment.isPending;
  const submitError = createSeries.error ?? updateSeries.error ?? setAssignment.error ?? null;
  const serverIssues = extractServerIssues(submitError);

  const validationMessages = Object.values(errors).flatMap((error) =>
    error && 'message' in error && error.message ? [String(error.message)] : [],
  );

  // Lowering the next number below the persisted value is allowed but warned.
  const loweringNextNumber =
    mode === 'edit' &&
    series !== undefined &&
    /^\d+$/.test(values.nextSeq.trim()) &&
    Number(values.nextSeq.trim()) < series.nextSeq;

  const onSubmit = form.handleSubmit(async (submitted) => {
    try {
      if (mode === 'edit' && series) {
        await updateSeries.mutateAsync({ seriesId: series.id, input: toSeriesUpdateInput(submitted) });
      } else {
        const main = await createSeries.mutateAsync(toMainCreateInput(submitted));
        let correctionSeriesId: string | null = null;
        if (submitted.correctionEnabled) {
          const correction = await createSeries.mutateAsync(toCorrectionCreateInput(submitted));
          correctionSeriesId = correction.id;
        }
        await setAssignment.mutateAsync({
          connectionId,
          input: { mainSeriesId: main.id, correctionSeriesId },
        });
      }
      showToast({ tone: 'success', title: 'Series saved', description: 'Invoice numbering is set.' });
      onDone();
    } catch {
      // Surfaced below via submitError / serverIssues.
    }
  });

  const heading =
    mode === 'setup'
      ? 'Set up numbering'
      : seriesLabel === 'correction'
        ? 'Edit correction series'
        : 'Edit main series';

  return (
    <div className="numbering-editor">
      <form
        className="numbering-editor__form"
        onSubmit={(event) => void onSubmit(event)}
        noValidate
      >
        <h3 className="section-title">{heading}</h3>

        {submitError && serverIssues.length === 0 ? (
          <Alert tone="error" title="Could not save the series">
            {submitError.message}
          </Alert>
        ) : null}
        {serverIssues.length > 0 ? (
          <Alert tone="error" title="The server rejected the series">
            <ul className="numbering-editor__server-issues">
              {serverIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
          <FormErrorSummary errors={validationMessages} />
        ) : null}

        <FormField label="Series name" name="name" error={errors.name?.message}>
          <Input {...form.register('name')} placeholder="Main invoices" />
        </FormField>

        <FormField
          label="Pattern"
          name="pattern"
          description="{seq} is required; everything else is literal text."
          error={errors.pattern?.message}
        >
          <Input
            {...patternRegister}
            ref={(node) => {
              patternRegister.ref(node);
              patternInputRef.current = node;
            }}
            className="mono-text"
            placeholder="FV/{seq}/{MM}/{YYYY}"
          />
        </FormField>

        <div className="numbering-editor__chips" role="group" aria-label="Insert pattern variable">
          {NUMBERING_VARIABLE_CHIPS.map((variable) => (
            <Chip key={variable} type="button" onClick={() => insertVariable(variable)}>
              <span className="mono-text">{variable}</span>
            </Chip>
          ))}
        </div>

        <FormField label="Reset counter" name="resetPolicy" error={errors.resetPolicy?.message}>
          <Select {...form.register('resetPolicy')}>
            {ResetPolicyValues.map((policy: ResetPolicy) => (
              <option key={policy} value={policy}>
                {RESET_POLICY_LABELS[policy]}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="numbering-editor__row">
          <FormField
            label="Padding"
            name="seqPadding"
            description="Leading zeros on {seq}."
            error={errors.seqPadding?.message}
          >
            <Input
              {...form.register('seqPadding')}
              type="number"
              min={0}
              max={20}
              inputMode="numeric"
            />
          </FormField>

          <FormField label="Next number" name="nextSeq" error={errors.nextSeq?.message}>
            <Input
              {...form.register('nextSeq')}
              type="number"
              min={1}
              inputMode="numeric"
            />
          </FormField>
        </div>

        {loweringNextNumber ? (
          <Alert tone="warning" title="Lowering the next number">
            Lowering the next number can reproduce a number you have already issued. Only do this
            when migrating from another system.
          </Alert>
        ) : null}

        {mode === 'setup' ? (
          <div className="numbering-editor__correction">
            <label className="numbering-editor__toggle">
              <input type="checkbox" {...form.register('correctionEnabled')} />
              <span>
                <strong>Separate series for corrections</strong>
                <span className="muted-text"> (prefilled FK/…)</span>
              </span>
            </label>
            <p className="muted-text numbering-editor__toggle-help">
              When off, corrections draw their number from the main series.
            </p>

            {values.correctionEnabled ? (
              <div className="numbering-editor__correction-fields">
                <FormField
                  label="Correction series name"
                  name="correctionName"
                  error={errors.correctionName?.message}
                >
                  <Input {...form.register('correctionName')} placeholder="Corrections" />
                </FormField>
                <FormField
                  label="Correction pattern"
                  name="correctionPattern"
                  error={errors.correctionPattern?.message}
                >
                  <Input
                    {...form.register('correctionPattern')}
                    className="mono-text"
                    placeholder="FK/{seq}/{MM}/{YYYY}"
                  />
                </FormField>
                <div className="numbering-editor__row">
                  <FormField
                    label="Correction reset counter"
                    name="correctionResetPolicy"
                    error={errors.correctionResetPolicy?.message}
                  >
                    <Select {...form.register('correctionResetPolicy')}>
                      {ResetPolicyValues.map((policy: ResetPolicy) => (
                        <option key={policy} value={policy}>
                          {RESET_POLICY_LABELS[policy]}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField
                    label="Correction padding"
                    name="correctionSeqPadding"
                    error={errors.correctionSeqPadding?.message}
                  >
                    <Input
                      {...form.register('correctionSeqPadding')}
                      type="number"
                      min={0}
                      max={20}
                      inputMode="numeric"
                    />
                  </FormField>
                  <FormField
                    label="Correction next number"
                    name="correctionNextSeq"
                    error={errors.correctionNextSeq?.message}
                  >
                    <Input
                      {...form.register('correctionNextSeq')}
                      type="number"
                      min={1}
                      inputMode="numeric"
                    />
                  </FormField>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="numbering-editor__actions">
          <Button type="button" tone="secondary" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" tone="primary" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save series'}
          </Button>
        </div>
      </form>

      <div className="numbering-editor__preview">
        <KsefNumberingPreview
          pattern={values.pattern}
          nextSeq={values.nextSeq}
          seqPadding={values.seqPadding}
          resetPolicy={values.resetPolicy}
        />
        {mode === 'setup' && values.correctionEnabled ? (
          <KsefNumberingPreview
            pattern={values.correctionPattern}
            nextSeq={values.correctionNextSeq}
            seqPadding={values.correctionSeqPadding}
            resetPolicy={values.correctionResetPolicy}
          />
        ) : null}
      </div>
    </div>
  );
}
