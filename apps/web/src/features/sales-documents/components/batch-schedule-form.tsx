/**
 * Batch schedule form (#3584, mockup M15 "Schedule")
 *
 * One document kind's schedule. A connection that issues invoices and receipts
 * in batches has one form per kind (#3582), so receipts can go out daily while
 * invoices wait for month end. Each schedule carries its own time zone.
 *
 * The month-end option states D42 in place: it issues only orders whose buyer
 * has a tax id, and consumer orders on the connection go out in a daily 23:00
 * run, so no order is left unissued.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import { salesDocumentBatchQueryKeys } from '../api/sales-document-batch.query-keys';
import type { BatchScheduleView } from '../api/sales-document-batch.types';
import type { ConcreteDocumentKind } from '../api/sales-documents.types';
import { useUpdateSalesDocumentMutation } from '../hooks/use-update-sales-document-mutation';
import {
  batchScheduleSchema,
  toBatchScheduleConfig,
  toBatchScheduleFormValues,
  type BatchScheduleFormSubmission,
  type BatchScheduleFormValues,
} from './batch-schedule.schema';

export const BATCH_KIND_LABELS: Record<ConcreteDocumentKind, string> = {
  invoice: 'Invoices',
  'fiscal-receipt': 'Fiscal receipts',
};

interface BatchScheduleFormProps {
  connectionId: string;
  kind: ConcreteDocumentKind;
  schedule: BatchScheduleView | undefined;
  disabled: boolean;
}

export function BatchScheduleForm({
  connectionId,
  kind,
  schedule,
  disabled,
}: BatchScheduleFormProps): ReactElement {
  const { updateField, isPending } = useUpdateSalesDocumentMutation();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const form = useForm<BatchScheduleFormValues, undefined, BatchScheduleFormSubmission>({
    defaultValues: toBatchScheduleFormValues(schedule),
    resolver: zodResolver(batchScheduleSchema),
  });
  const frequency = form.watch('frequency');
  const errors = form.formState.errors;
  const label = BATCH_KIND_LABELS[kind];
  const idPrefix = `batch-schedule-${kind}`;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updateField({
        connectionId,
        patch: { batchSchedule: { kind, value: toBatchScheduleConfig(values, new Date()) } },
      });
      // The next slots shown are computed from the stored schedule.
      await queryClient.invalidateQueries({
        queryKey: salesDocumentBatchQueryKeys.overview(connectionId),
      });
      form.reset(values);
      showToast({
        tone: 'success',
        title: 'Schedule saved',
        description: `${label} schedule updated.`,
      });
    } catch (error) {
      form.setError('root', {
        message: error instanceof Error ? error.message : 'The schedule could not be saved.',
      });
    }
  });

  return (
    <form className="batch-schedule-form" onSubmit={(event) => void onSubmit(event)} noValidate>
      <h4 className="batch-schedule-form__title">{label}</h4>
      {errors.root?.message ? <Alert tone="error">{errors.root.message}</Alert> : null}
      {schedule?.frequency === null || schedule === undefined ? (
        <p className="muted-text">
          No schedule yet. Queued {label.toLowerCase()} wait until you save one or start a run by
          hand.
        </p>
      ) : null}
      <FormField label="Frequency" name={`${idPrefix}-frequency`}>
        <Select {...form.register('frequency')} disabled={disabled}>
          <option value="daily">Daily, at a fixed time</option>
          <option value="every-n-hours">Every N hours</option>
          <option value="month-end">Month end (business customers only)</option>
        </Select>
      </FormField>
      {frequency === 'daily' ? (
        <FormField label="Time" name={`${idPrefix}-time`} error={errors.time?.message}>
          <Input type="time" {...form.register('time')} disabled={disabled} />
        </FormField>
      ) : null}
      {frequency === 'every-n-hours' ? (
        <FormField
          label="Every"
          name={`${idPrefix}-every-hours`}
          description="Hours between runs, starting at 00:00."
          error={errors.everyHours?.message}
        >
          <Input
            type="number"
            min={1}
            max={24}
            {...form.register('everyHours')}
            disabled={disabled}
          />
        </FormField>
      ) : null}
      {frequency === 'month-end' ? (
        <Alert tone="info" title="Business customers on the last day, everyone else daily">
          Runs on the last calendar day of the month at 23:00 and issues orders whose buyer has a
          company tax ID. Orders without one on this connection go out every day at 23:00, so no
          order is left unissued.
        </Alert>
      ) : null}
      <FormField
        label="Time zone"
        name={`${idPrefix}-time-zone`}
        description="The times above are read in this zone."
        error={errors.timeZone?.message}
      >
        <Input {...form.register('timeZone')} disabled={disabled} />
      </FormField>
      <div className="batch-schedule-form__actions">
        <Button type="submit" disabled={disabled || isPending}>
          {isPending ? 'Saving…' : `Save ${label.toLowerCase()} schedule`}
        </Button>
      </div>
    </form>
  );
}
