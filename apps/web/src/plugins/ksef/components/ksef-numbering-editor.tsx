/**
 * KSeF numbering editor
 *
 * Two-column editing surface: the form on the left, the live-preview panel on
 * the right (which moves directly above the form on the mobile breakpoint via
 * CSS `order`, so the number stays visible while typing). Creates a new series
 * or patches an existing one. Client-side Zod mirrors the core rule for instant
 * feedback; the API stays the source of truth — server 400 `errors[]` are
 * mapped onto the pattern field via `setError`, other rejections surface in a
 * single top-level alert (no duplicate toast).
 *
 * @module plugins/ksef/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  useCreateNumberingSeriesMutation,
  useUpdateNumberingSeriesMutation,
  DocumentTypeValues,
  ResetPolicyValues,
  type DocumentType,
  type NumberingSeries,
  type ResetPolicy,
} from '../../../features/invoicing';
import { ApiError } from '../../../shared/api/api-error';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import { useMediaQuery } from '../../../shared/ui/use-media-query';
import { KsefNumberingPreview } from './ksef-numbering-preview';
import {
  DOCUMENT_TYPE_LABELS,
  NUMBERING_VARIABLE_CHIPS,
  RESET_POLICY_LABELS,
} from './ksef-numbering.lib';
import {
  NUMBERING_CREATE_DEFAULTS,
  SERVER_ISSUE_FIELD,
  numberingFormSchema,
  seriesToFormValues,
  toCreateInput,
  toUpdateInput,
  type NumberingFormValues,
} from './ksef-numbering.schema';

interface KsefNumberingEditorProps {
  connectionId: string;
  /** The series being edited (edit mode); absent = create mode. */
  series?: NumberingSeries;
  /** Create-mode prefill from a routing row ("Add a series first"). */
  createPrefill?: { documentType?: DocumentType; register?: string | null };
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
  connectionId: _connectionId,
  series,
  createPrefill,
  onDone,
  onCancel,
}: KsefNumberingEditorProps): ReactElement {
  const isEdit = series !== undefined;
  const { showToast } = useToast();
  const createSeries = useCreateNumberingSeriesMutation();
  const updateSeries = useUpdateNumberingSeriesMutation();
  const patternInputRef = useRef<HTMLInputElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [topLevelError, setTopLevelError] = useState<string | null>(null);
  // Server pattern-coverage issues are held in local state (not only RHF
  // `setError`) because a resolver re-run can clear a manually-set field error;
  // this keeps the field-level message visible until the pattern is edited.
  const [patternServerError, setPatternServerError] = useState<string | null>(null);
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  // Focus the heading when the editor mounts so keyboard / SR users land on the
  // new surface rather than being dropped at the top of the document.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: prefersReducedMotion });
  }, [prefersReducedMotion]);

  const createDefaults: NumberingFormValues = {
    ...NUMBERING_CREATE_DEFAULTS,
    ...(createPrefill?.documentType ? { documentType: createPrefill.documentType } : {}),
    ...(createPrefill?.register != null ? { register: createPrefill.register } : {}),
  };

  const form = useForm<NumberingFormValues>({
    defaultValues: series ? seriesToFormValues(series) : createDefaults,
    resolver: zodResolver(numberingFormSchema),
    mode: 'onChange',
  });

  const values = form.watch();
  const { errors } = form.formState;
  const patternRegister = form.register('pattern');

  // Clear a stale server pattern error once the operator edits the pattern.
  useEffect(() => {
    setPatternServerError(null);
  }, [values.pattern]);

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
    requestAnimationFrame(() => {
      const caret = start + variable.length;
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  }

  const isPending = createSeries.isPending || updateSeries.isPending;

  const validationMessages = Object.values(errors).flatMap((error) =>
    error && 'message' in error && error.message ? [String(error.message)] : [],
  );

  const loweringNextNumber =
    isEdit &&
    series !== undefined &&
    /^\d+$/.test(values.nextSeq.trim()) &&
    Number(values.nextSeq.trim()) < series.nextSeq;

  // Editing the document type of a series can orphan or mis-show a route that
  // still points at it (routes match a series by its document type).
  const documentTypeChanged =
    isEdit && series !== undefined && values.documentType !== series.documentType;

  // A series that has already issued numbers (nextSeq > 1) is live; changing its
  // pattern only affects numbers going forward, on every routed connection.
  const patternChangedWithIssued =
    isEdit &&
    series !== undefined &&
    series.nextSeq > 1 &&
    values.pattern.trim() !== series.pattern.trim();

  const onSubmit = form.handleSubmit(async (submitted) => {
    setTopLevelError(null);
    setPatternServerError(null);
    try {
      if (isEdit && series) {
        await updateSeries.mutateAsync({ seriesId: series.id, input: toUpdateInput(submitted) });
      } else {
        await createSeries.mutateAsync(toCreateInput(submitted));
      }
      showToast({ tone: 'success', title: 'Series saved', description: 'Invoice numbering is set.' });
      onDone();
    } catch (error) {
      const issues = extractServerIssues(error);
      if (issues.length > 0) {
        // Server pattern-coverage issues are identifiable — attach to the field.
        const joined = issues.join(' ');
        setPatternServerError(joined);
        form.setError(SERVER_ISSUE_FIELD, { type: 'server', message: joined });
        patternInputRef.current?.focus({ preventScroll: prefersReducedMotion });
      } else {
        setTopLevelError(error instanceof Error ? error.message : 'Could not save the series.');
      }
    }
  });

  const heading = isEdit ? 'Edit series' : 'Add series';

  return (
    <div className="numbering-editor">
      <form
        className="numbering-editor__form"
        onSubmit={(event) => void onSubmit(event)}
        noValidate
      >
        <h3 className="section-title" ref={headingRef} tabIndex={-1}>
          {heading}
        </h3>

        {topLevelError ? (
          <Alert tone="error" title="Could not save the series">
            {topLevelError}
          </Alert>
        ) : null}

        {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
          <FormErrorSummary errors={validationMessages} />
        ) : null}

        <FormField label="Series name" name="name" error={errors.name?.message}>
          <Input {...form.register('name')} placeholder="Sales invoices" />
        </FormField>

        <div className="numbering-editor__row">
          <FormField
            label="Document type"
            name="documentType"
            description="Which document this series numbers."
            error={errors.documentType?.message}
          >
            <Select {...form.register('documentType')}>
              {DocumentTypeValues.map((type: DocumentType) => (
                <option key={type} value={type}>
                  {DOCUMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label="Register / entity"
            name="register"
            description="Optional scope; leave blank for the default."
            error={errors.register?.message}
          >
            <Input {...form.register('register')} placeholder="e.g. warehouse-2" />
          </FormField>
        </div>

        {documentTypeChanged ? (
          <Alert tone="warning" title="Changing the document type">
            This series may already be routed to a document type. Changing it can leave that route
            pointing at a series that no longer matches. Recheck document routing after saving.
          </Alert>
        ) : null}

        <FormField
          label="Pattern"
          name="pattern"
          description="{seq} is required; everything else is literal text. The series is shared, so a change applies to every connection routed to it."
          error={errors.pattern?.message ?? patternServerError ?? undefined}
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

        <div className="numbering-editor__chips">
          {NUMBERING_VARIABLE_CHIPS.map((variable) => (
            <button
              key={variable}
              type="button"
              className="numbering-chip"
              aria-label={`Insert ${variable}`}
              onClick={() => insertVariable(variable)}
            >
              <span className="mono-text">{variable}</span>
            </button>
          ))}
        </div>

        {patternChangedWithIssued ? (
          <Alert tone="warning" title="Changing an in-use pattern">
            This series has already issued numbers. A new pattern changes the format only for
            numbers going forward, on every connection routed to this series.
          </Alert>
        ) : null}

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
            <Input {...form.register('seqPadding')} type="number" min={0} max={20} inputMode="numeric" />
          </FormField>

          <FormField
            label="Next number"
            name="nextSeq"
            description="Where the series continues from. Issued numbers are permanent and gap-sensitive, and the series is shared across every routed connection."
            error={errors.nextSeq?.message}
          >
            <Input {...form.register('nextSeq')} type="number" min={1} inputMode="numeric" />
          </FormField>
        </div>

        {loweringNextNumber ? (
          <Alert tone="warning" title="Lowering the next number">
            Lowering the next number can reproduce a number you have already issued. Only do this when
            migrating from another system.
          </Alert>
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
      </div>
    </div>
  );
}
