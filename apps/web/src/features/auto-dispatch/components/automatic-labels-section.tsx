/**
 * Automatic shipping labels section (#2729 backend, #3572 screen)
 *
 * The one place an operator turns automatic labels on, says WHEN the label is
 * bought, sets the parcel defaults, tries them on recent orders and reads back
 * what was refused. Mounted on the OpenLinker OMS status page, because the OMS
 * is the connection that holds the work and its detail page has no Edit form
 * ("Managed from Packing settings").
 *
 * ## Save is a read-modify-write of `config`
 *
 * `PATCH /connections/:id` replaces `config` whole, so the save builds from a
 * config read at that moment (`use-save-auto-dispatch-mutation`). The form never
 * holds the config itself, only the `autoDispatch` key's values.
 *
 * ## Preview runs the draft, not the saved value
 *
 * What is previewed is what Save would write: the form values, validated by the
 * same schema. An invalid form cannot be previewed.
 *
 * ## Access
 *
 * A read-only role (or demo mode) sees the settings, the refusals and the
 * preview, with the inputs disabled and no Save; the preview is a read, so it
 * stays available.
 *
 * @module apps/web/src/features/auto-dispatch/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';

import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';
import { useConnectionQuery } from '../../connections';
import type { AutoDispatchPreview } from '../api/auto-dispatch.types';
import { AutoDispatchTriggerValues } from '../api/auto-dispatch.types';
import { useAutoDispatchPreviewMutation } from '../hooks/use-auto-dispatch-preview-mutation';
import { useSaveAutoDispatchMutation } from '../hooks/use-save-auto-dispatch-mutation';
import {
  hasUnrecognisedTrigger,
  readAutoDispatchForm,
  toPreviewRequest,
} from '../lib/auto-dispatch-config';
import { autoDispatchCopy } from '../lib/auto-dispatch.copy';
import {
  automaticLabelsSchema,
  toAutoDispatchSettings,
  type AutomaticLabelsFormValues,
  type AutomaticLabelsSubmission,
} from './automatic-labels.schema';
import { AutoDispatchPreviewPanel } from './auto-dispatch-preview';
import { AutoDispatchRefusals } from './auto-dispatch-refusals';

const COPY = autoDispatchCopy;
const PREVIEW_LIMIT = 10;

export interface AutomaticLabelsSectionProps {
  /** The connection that does the packing (the OpenLinker OMS). */
  readonly connectionId: string;
  readonly canWrite: boolean;
  /** Whether a write control is shown at all (a read-only role in demo mode still sees it, disabled). */
  readonly writeVisible: boolean;
  readonly demoReadOnly: boolean;
  /**
   * Rendered inside a wizard step that already owns the panel, the title and the
   * intro (#3572): no panel of its own, and no refusal list, because before packing
   * is on there is nothing to have been refused. The settings page uses the default.
   */
  readonly embedded?: boolean;
}

/** The anchor the setup list's "Shipping labels" row links to (`#automatic-labels`). */
export const AUTOMATIC_LABELS_ANCHOR = 'automatic-labels';

function Shell(props: { readonly embedded: boolean; readonly children: ReactNode }): ReactElement {
  return props.embedded ? (
    <div className="auto-dispatch__embedded" data-testid="automatic-labels">
      {props.children}
    </div>
  ) : (
    <section
      id={AUTOMATIC_LABELS_ANCHOR}
      className="panel oms-onboarding__panel"
      data-testid="automatic-labels"
    >
      {props.children}
    </section>
  );
}

export function AutomaticLabelsSection(props: AutomaticLabelsSectionProps): ReactElement {
  const embedded = props.embedded === true;
  const connectionQuery = useConnectionQuery(props.connectionId);
  const connection = connectionQuery.data;

  if (connectionQuery.isLoading) {
    return (
      <Shell embedded={embedded}>
        {embedded ? null : <h2 className="oms-onboarding__panel-title">{COPY.section.title}</h2>}
        <p className="auto-dispatch__help" aria-live="polite">
          {COPY.section.loading}
        </p>
      </Shell>
    );
  }

  if (connectionQuery.error || connection === undefined) {
    return (
      <Shell embedded={embedded}>
        {embedded ? null : <h2 className="oms-onboarding__panel-title">{COPY.section.title}</h2>}
        <Alert
          tone="error"
          title={COPY.section.loadFailedTitle}
          action={
            <Button tone="secondary" onClick={() => void connectionQuery.refetch()}>
              {COPY.section.retry}
            </Button>
          }
        >
          {connectionQuery.error?.message ?? COPY.section.loadFailedTitle}
        </Alert>
      </Shell>
    );
  }

  return <LabelsForm {...props} config={connection.config} />;
}

interface LabelsFormProps extends AutomaticLabelsSectionProps {
  readonly config: Record<string, unknown>;
}

function LabelsForm(props: LabelsFormProps): ReactElement {
  const { showToast } = useToast();
  const save = useSaveAutoDispatchMutation();
  const preview = useAutoDispatchPreviewMutation();
  const [previewResult, setPreviewResult] = useState<AutoDispatchPreview | null | undefined>(
    undefined
  );

  const stored = readAutoDispatchForm(props.config);
  const form = useForm<AutomaticLabelsFormValues, undefined, AutomaticLabelsSubmission>({
    defaultValues: stored,
    resolver: zodResolver(automaticLabelsSchema),
  });

  // A save (or a change made elsewhere) re-reads the connection; the form then
  // starts from what is actually stored rather than from what it last held.
  const storedKey = JSON.stringify(stored);
  useEffect(() => {
    form.reset(readAutoDispatchForm(props.config));
    // `storedKey` is the derived dependency; `props.config` identity changes every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the stored values change
  }, [storedKey]);

  const readOnly = !props.canWrite;
  const values = form.watch();
  const weightEmpty = values.defaultWeightGrams.trim() === '';
  const disabledTitle = props.demoReadOnly ? DEMO_READ_ONLY_ACTION_MESSAGE : undefined;

  const onSubmit = form.handleSubmit(async (submission) => {
    try {
      await save.mutateAsync({
        connectionId: props.connectionId,
        settings: toAutoDispatchSettings(submission),
      });
      showToast({ tone: 'success', title: COPY.section.title, description: COPY.section.saved });
    } catch {
      // Shown by the Alert from `save.error`.
    }
  });

  const runPreview = async (): Promise<void> => {
    const parsed = automaticLabelsSchema.safeParse(form.getValues());
    if (!parsed.success) {
      // Surface the field messages beside the inputs instead of previewing a draft that cannot save.
      await form.trigger();
      return;
    }
    try {
      setPreviewResult(
        await preview.mutateAsync({
          connectionId: props.connectionId,
          draft: toPreviewRequest(toAutoDispatchSettings(parsed.data), PREVIEW_LIMIT),
        })
      );
    } catch {
      // Shown by the preview panel from `preview.error`.
    }
  };

  const embedded = props.embedded === true;

  return (
    <Shell embedded={embedded}>
      {embedded ? null : (
        <div className="oms-onboarding__panel-head">
          <h2 className="oms-onboarding__panel-title">{COPY.section.title}</h2>
          <p className="oms-onboarding__why">{COPY.section.intro}</p>
        </div>
      )}

      {readOnly ? (
        <Alert tone="info" title={COPY.section.title}>
          {COPY.section.readOnly}
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="auto-dispatch__form">
        {save.error ? (
          <Alert tone="error" title={COPY.section.saveFailedTitle}>
            {save.error.message}
          </Alert>
        ) : null}

        {hasUnrecognisedTrigger(props.config) ? (
          <Alert tone="warning" title={COPY.section.triggerLegend}>
            {COPY.section.unrecognisedTrigger}
          </Alert>
        ) : null}

        <label className="rate-limit-section__toggle">
          <input type="checkbox" disabled={readOnly} {...form.register('enabled')} />
          <span>{COPY.section.enabled}</span>
        </label>

        <fieldset className="auto-dispatch__fieldset" disabled={readOnly}>
          <legend className="auto-dispatch__legend">{COPY.section.triggerLegend}</legend>
          {AutoDispatchTriggerValues.map((trigger) => (
            <label className="auto-dispatch__radio" key={trigger}>
              <input type="radio" value={trigger} {...form.register('trigger')} />
              <span>
                <span className="auto-dispatch__radio-label">{COPY.triggers[trigger].label}</span>
                <span className="auto-dispatch__help">{COPY.triggers[trigger].description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="auto-dispatch__fieldset" disabled={readOnly}>
          <legend className="auto-dispatch__legend">{COPY.parcel.legend}</legend>
          <p className="auto-dispatch__help">{COPY.parcel.help}</p>

          <FormField
            label={COPY.parcel.weight}
            name="defaultWeightGrams"
            description={COPY.parcel.weightHelp}
            error={form.formState.errors.defaultWeightGrams?.message}
          >
            <Input type="text" inputMode="numeric" {...form.register('defaultWeightGrams')} />
          </FormField>
          {weightEmpty ? (
            <p className="auto-dispatch__note" data-testid="auto-dispatch-weight-note">
              {COPY.parcel.weightEmptyNote}
            </p>
          ) : null}

          <FormField
            label={COPY.parcel.template}
            name="parcelTemplate"
            description={COPY.parcel.templateHelp}
            error={form.formState.errors.parcelTemplate?.message}
          >
            <Input type="text" {...form.register('parcelTemplate')} />
          </FormField>

          <div className="auto-dispatch__box">
            <p className="auto-dispatch__help">
              {COPY.parcel.box} — {COPY.parcel.boxHelp}
            </p>
            <div className="auto-dispatch__box-fields">
              <FormField
                label={COPY.parcel.length}
                name="lengthMm"
                error={form.formState.errors.lengthMm?.message}
              >
                <Input type="text" inputMode="numeric" {...form.register('lengthMm')} />
              </FormField>
              <FormField
                label={COPY.parcel.width}
                name="widthMm"
                error={form.formState.errors.widthMm?.message}
              >
                <Input type="text" inputMode="numeric" {...form.register('widthMm')} />
              </FormField>
              <FormField
                label={COPY.parcel.height}
                name="heightMm"
                error={form.formState.errors.heightMm?.message}
              >
                <Input type="text" inputMode="numeric" {...form.register('heightMm')} />
              </FormField>
            </div>
          </div>
        </fieldset>

        {props.writeVisible ? (
          <div className="oms-onboarding__actions">
            <Button
              type="submit"
              tone="primary"
              data-testid="btn-auto-dispatch-save"
              disabled={readOnly || save.isPending || !form.formState.isDirty}
              title={disabledTitle}
            >
              {save.isPending ? COPY.section.saving : COPY.section.save}
            </Button>
            <Button
              type="button"
              tone="ghost"
              disabled={readOnly || save.isPending || !form.formState.isDirty}
              onClick={() => form.reset(readAutoDispatchForm(props.config))}
            >
              {COPY.section.revert}
            </Button>
          </div>
        ) : null}
      </form>

      <AutoDispatchPreviewPanel
        onRun={() => void runPreview()}
        running={preview.isPending}
        disabled={false}
        error={preview.error}
        result={previewResult}
      />

      {embedded ? null : <AutoDispatchRefusals connectionId={props.connectionId} />}
    </Shell>
  );
}
