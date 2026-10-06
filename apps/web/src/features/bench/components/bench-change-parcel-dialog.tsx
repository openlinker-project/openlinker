/**
 * Change size (#3655)
 *
 * Lets the packer holding the box correct the parcel a label was bought for.
 * PARCEL DATA ONLY: a size, a box in cm and kg, or a weight. There is no
 * address, recipient or carrier input, and none may be added - the server
 * derives all three (#3654).
 *
 * One click sends one request. The confirm sentence is on screen the whole
 * time rather than behind a second step, and the submit is disabled while the
 * request is in flight, with a ref guard for the frame before React re-renders.
 * A refusal keeps the dialog open and the old label in place; success and
 * `cancelled-not-replaced` (confirmed or in-doubt void) are handed to the
 * caller, which owns the card. Any other failure says only that it did not go
 * through: it cannot know whether the old label was cancelled, so it does not
 * claim either answer.
 *
 * @module apps/web/src/features/bench/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import type { BenchLabelReplaceResult } from '../api/bench-parcel.types';
import { useBenchReplaceLabelMutation } from '../hooks/use-bench-replace-label-mutation';
import {
  MAX_SIDE_CM,
  MAX_WEIGHT_KG,
  toReplaceInput,
  type ChangeSizeFormValues,
  type ChangeSizeMode,
} from '../lib/bench-label-replace';
import { benchParcelCopy } from '../lib/bench-parcel.copy';

const copy = benchParcelCopy.changeSize;

const positive = (max: number) =>
  z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const n = Number(value.replace(',', '.'));
      if (value === '' || !Number.isFinite(n) || n <= 0) {
        ctx.addIssue({ code: 'custom', message: copy.required });
      } else if (n > max) {
        ctx.addIssue({ code: 'custom', message: copy.tooLarge });
      }
    });

const schema = z
  .object({
    mode: z.enum(['template', 'box', 'weight']),
    template: z.string(),
    lengthCm: z.string(),
    widthCm: z.string(),
    heightCm: z.string(),
    weightKg: z.string(),
  })
  .superRefine((values, ctx) => {
    const check = (
      field: 'template' | 'lengthCm' | 'widthCm' | 'heightCm' | 'weightKg',
      rule: z.ZodTypeAny
    ): void => {
      const parsed = rule.safeParse(values[field]);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', path: [field], message: parsed.error.issues[0].message });
      }
    };
    if (values.mode === 'template') {
      if (values.template === '') {
        ctx.addIssue({ code: 'custom', path: ['template'], message: copy.pickTemplate });
      }
      return;
    }
    if (values.mode === 'box') {
      check('lengthCm', positive(MAX_SIDE_CM));
      check('widthCm', positive(MAX_SIDE_CM));
      check('heightCm', positive(MAX_SIDE_CM));
    }
    check('weightKg', positive(MAX_WEIGHT_KG));
  });

const REFUSAL_COPY: Record<string, string> = {
  'cannot-cancel': copy.refusedCannotCancel,
  'adapter-unresolved': copy.refusedAdapterUnresolved,
  'already-handed-over': copy.refusedAlreadyHandedOver,
  'parcel-completed': copy.refusedParcelCompleted,
  'no-label': copy.refusedNoLabel,
  'recipient-unavailable': copy.refusedRecipientUnavailable,
  'parcel-size-unknown': copy.refusedParcelSizeUnknown,
  'replace-in-progress': copy.refusedReplaceInProgress,
};

export interface BenchChangeParcelDialogProps {
  readonly workId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Size codes the carrier offers; empty hides the "Pick a size" mode. */
  readonly templates: readonly string[];
  /** Called for `replaced` and `cancelled-not-replaced`; the dialog is closed by the caller. */
  readonly onResolved: (result: BenchLabelReplaceResult) => void;
}

const DEFAULTS: ChangeSizeFormValues = {
  mode: 'box',
  template: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
  weightKg: '',
};

export function BenchChangeParcelDialog({
  workId,
  open,
  onOpenChange,
  templates,
  onResolved,
}: BenchChangeParcelDialogProps): ReactElement {
  const mutation = useBenchReplaceLabelMutation();
  const inFlight = useRef(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ChangeSizeFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...DEFAULTS, mode: templates.length > 0 ? 'template' : 'box' },
  });
  const mode = watch('mode');
  const pending = mutation.isPending;

  const modes: ReadonlyArray<{ id: ChangeSizeMode; label: string }> = [
    ...(templates.length > 0
      ? [{ id: 'template' as const, label: copy.modeTemplate }]
      : []),
    { id: 'box', label: copy.modeBox },
    { id: 'weight', label: copy.modeWeight },
  ];

  const submit = handleSubmit((values) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefusal(null);
    setFailed(false);
    mutation.mutate(
      { workId, input: toReplaceInput(values) },
      {
        onSuccess: (result) => {
          if (result.outcome === 'refused') {
            setRefusal(REFUSAL_COPY[result.reason ?? ''] ?? copy.refusedUnknown);
            return;
          }
          reset();
          onResolved(result);
        },
        onError: () => {
          setFailed(true);
        },
        onSettled: () => {
          inFlight.current = false;
        },
      }
    );
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="bench-change-size" data-testid="bench-change-size">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>

        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
          className="bench-change-size__form"
        >
          <fieldset className="bench-change-size__modes" disabled={pending}>
            <legend>{copy.modeLegend}</legend>
            {modes.map((option) => (
              <Button
                key={option.id}
                type="button"
                tone={mode === option.id ? 'primary' : 'secondary'}
                aria-pressed={mode === option.id}
                className="bench-change-size__mode"
                onClick={() => {
                  setValue('mode', option.id);
                }}
              >
                {option.label}
              </Button>
            ))}
          </fieldset>

          {mode === 'template' ? (
            <FormField label={copy.templateLabel} name="template" error={errors.template?.message}>
              <Select className="bench-change-size__control" {...register('template')}>
                <option value="">{copy.templatePlaceholder}</option>
                {templates.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}

          {mode === 'box' ? (
            <>
              <FormField label={copy.lengthLabel} name="lengthCm" error={errors.lengthCm?.message}>
                <Input inputMode="decimal" className="bench-change-size__control" {...register('lengthCm')} />
              </FormField>
              <FormField label={copy.widthLabel} name="widthCm" error={errors.widthCm?.message}>
                <Input inputMode="decimal" className="bench-change-size__control" {...register('widthCm')} />
              </FormField>
              <FormField label={copy.heightLabel} name="heightCm" error={errors.heightCm?.message}>
                <Input inputMode="decimal" className="bench-change-size__control" {...register('heightCm')} />
              </FormField>
            </>
          ) : null}

          {mode === 'box' || mode === 'weight' ? (
            <FormField label={copy.weightKgLabel} name="weightKg" error={errors.weightKg?.message}>
              <Input inputMode="decimal" className="bench-change-size__control" {...register('weightKg')} />
            </FormField>
          ) : null}

          <p className="bench-change-size__notice">{copy.confirmNotice}</p>

          {refusal === null ? null : (
            <Alert tone="warning" data-testid="bench-change-size-refusal">
              {refusal}
            </Alert>
          )}
          {failed ? <Alert tone="error">{copy.failed}</Alert> : null}

          <DialogFooter>
            <Button
              type="button"
              tone="secondary"
              disabled={pending}
              className="bench-change-size__action"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {copy.cancelAction}
            </Button>
            <Button type="submit" tone="primary" disabled={pending} className="bench-change-size__action">
              {pending ? copy.pendingAction : copy.confirmAction}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
