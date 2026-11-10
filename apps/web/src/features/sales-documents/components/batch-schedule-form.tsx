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
import { useBatchCopy } from '../hooks/use-batch-copy';
import { useUpdateSalesDocumentMutation } from '../hooks/use-update-sales-document-mutation';
import { joinSentences } from '../lib/describe-batch-run';
import {
  batchScheduleSchema,
  toBatchScheduleConfig,
  toBatchScheduleFormValues,
  type BatchScheduleFormSubmission,
  type BatchScheduleFormValues,
} from './batch-schedule.schema';
import { describeApiError } from '../../../shared/api/describe-api-error';

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
  const { copy: batchCopy } = useBatchCopy();
  const copy = batchCopy.form;
  const kindKey = kind === 'invoice' ? 'invoice' : 'fiscalReceipt';
  const queryClient = useQueryClient();
  const form = useForm<BatchScheduleFormValues, undefined, BatchScheduleFormSubmission>({
    defaultValues: toBatchScheduleFormValues(schedule),
    resolver: zodResolver(batchScheduleSchema),
  });
  const frequency = form.watch('frequency');
  const errors = form.formState.errors;
  const label = copy.kinds[kindKey];
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
        title: copy.savedTitle,
        description: copy.savedDescription[kindKey],
      });
    } catch (error) {
      form.setError('root', {
        message: error instanceof Error ? describeApiError(error, 'sales-documents') : copy.saveFailed,
      });
    }
  });

  return (
    <form className="batch-schedule-form" onSubmit={(event) => void onSubmit(event)} noValidate>
      <h4 className="batch-schedule-form__title">{label}</h4>
      {errors.root?.message ? <Alert tone="error">{errors.root.message}</Alert> : null}
      {schedule?.frequency === null || schedule === undefined ? (
        <p className="muted-text">
          {joinSentences(copy.noScheduleYet, copy.noScheduleWait[kindKey])}
        </p>
      ) : null}
      <FormField label={copy.frequency} name={`${idPrefix}-frequency`}>
        <Select {...form.register('frequency')} disabled={disabled}>
          <option value="daily">{copy.frequencies.daily}</option>
          <option value="every-n-hours">{copy.frequencies.everyNHours}</option>
          <option value="month-end">{copy.frequencies.monthEnd}</option>
        </Select>
      </FormField>
      {frequency === 'daily' ? (
        <FormField label={copy.time} name={`${idPrefix}-time`} error={errors.time?.message}>
          <Input type="time" {...form.register('time')} disabled={disabled} />
        </FormField>
      ) : null}
      {frequency === 'every-n-hours' ? (
        <FormField
          label={copy.every}
          name={`${idPrefix}-every-hours`}
          description={copy.everyDescription}
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
        <Alert tone="info" title={copy.monthEndTitle}>
          {joinSentences(copy.monthEndLastDay, copy.monthEndDaily)}
        </Alert>
      ) : null}
      <FormField
        label={copy.timeZone}
        name={`${idPrefix}-time-zone`}
        description={copy.timeZoneDescription}
        error={errors.timeZone?.message}
      >
        <Input {...form.register('timeZone')} disabled={disabled} />
      </FormField>
      <div className="batch-schedule-form__actions">
        <Button type="submit" disabled={disabled || isPending}>
          {isPending ? copy.saving : copy.save[kindKey]}
        </Button>
      </div>
    </form>
  );
}
