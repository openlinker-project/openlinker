/**
 * Trigger Sync Dialog
 *
 * Modal dialog for manually enqueuing a sync job for a given connection.
 * Provides guided job-type selection, per-type payload forms, idempotency
 * key generation, and result feedback via toast.
 *
 * @module apps/web/src/features/sync-jobs/components
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useEnqueueSyncJobMutation } from '../hooks/use-enqueue-sync-job-mutation';
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
import { useToast } from '../../../shared/ui/toast-provider';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { interpolate, renderRich, useMessages, type Messages } from '../../../shared/i18n';
import {
  OrderPositionField,
  ORDER_POSITION_CUSTOM,
  ORDER_POSITION_DEFAULT,
} from './order-position-field';
import { useAdaptersQuery } from '../../adapters';
import { OrderRangeFields } from './order-range-fields';
import {
  ORDER_RANGE_DEFAULT_VALUE,
  toOrderImportPayload,
  validateOrderRange,
  type OrderRangeValue,
} from '../lib/order-range';
import type { PayloadField, TriggerableJob, TriggerSyncDialogProps } from './trigger-sync-dialog.types';

type TriggerSyncDialogCopy = Messages['sync-jobs']['triggerSyncDialog'];

function buildTriggerableJobs(copy: TriggerSyncDialogCopy): TriggerableJob[] {
  const { fields, jobs } = copy;
  return [
    {
      jobType: 'master.product.syncAll',
      label: jobs.syncAllProducts.label,
      description: jobs.syncAllProducts.description,
      payloadFields: [],
      requiredCapability: 'ProductMaster',
    },
    {
      jobType: 'master.product.syncByExternalId',
      label: jobs.syncProductById.label,
      description: jobs.syncProductById.description,
      payloadFields: [
        { name: 'externalId', label: fields.externalId, required: true },
        { name: 'objectType', label: fields.objectType, required: false, placeholder: 'product' },
      ],
      requiredCapability: 'ProductMaster',
    },
    {
      jobType: 'master.inventory.syncAll',
      label: jobs.syncAllInventory.label,
      description: jobs.syncAllInventory.description,
      payloadFields: [],
      requiredCapability: 'InventoryMaster',
    },
    {
      jobType: 'master.inventory.syncByExternalId',
      label: jobs.syncInventoryById.label,
      description: jobs.syncInventoryById.description,
      payloadFields: [
        { name: 'externalId', label: fields.externalId, required: true },
        { name: 'objectType', label: fields.objectType, required: false, placeholder: 'product' },
      ],
      requiredCapability: 'InventoryMaster',
    },
    {
      jobType: 'master.variants.autoMatch',
      label: jobs.autoMatchVariants.label,
      description: jobs.autoMatchVariants.description,
      payloadFields: [],
      requiredCapability: 'ProductMaster',
    },
    {
      jobType: 'marketplace.offers.sync',
      label: jobs.syncOffers.label,
      description: jobs.syncOffers.description,
      payloadFields: [
        {
          name: 'limit',
          label: fields.pageLimit,
          required: false,
          type: 'number',
          defaultValue: '100',
          placeholder: '100',
        },
      ],
      // OfferEventReader, not coarse OfferManager (#1498): only adapters with an
      // offer-event journal (Allegro) can sync offers this way. Erli (reconciliation
      // -first, #1096 skip) and WooCommerce (quantity-only write-back) would no-op.
      requiredCapability: 'OfferEventReader',
    },
    {
      jobType: 'marketplace.orders.poll',
      label: jobs.pollOrders.label,
      description: jobs.pollOrders.description,
      payloadFields: [
        {
          name: 'limit',
          label: copy.orderPosition.limitLabel,
          required: false,
          type: 'number',
          defaultValue: '100',
          placeholder: '100',
          description: copy.orderPosition.limitHelp,
        },
      ],
      // OrderSource, not OfferManager (#1498): this is an order-ingestion job —
      // every order source (Allegro, Erli, WooCommerce, PrestaShop) runs it via
      // its scheduler, so the manual trigger should match that set.
      requiredCapability: 'OrderSource',
    },
    {
      jobType: 'inventory.propagateToMarketplaces',
      label: jobs.propagateInventory.label,
      description: jobs.propagateInventory.description,
      payloadFields: [
        {
          name: 'productId',
          label: fields.productId,
          required: true,
          placeholder: 'ol_product_…',
        },
      ],
      // Gated to InventoryMaster (the capability whose inventory it propagates) so it
      // no longer leaks onto invoicing/shipping-only connections (KSeF, InPost). See #1474.
      requiredCapability: 'InventoryMaster',
    },
    {
      jobType: 'invoicing.regulatoryStatus.reconcile',
      label: jobs.reconcileRegulatoryStatus.label,
      description: jobs.reconcileRegulatoryStatus.description,
      payloadFields: [
        {
          name: 'limit',
          label: fields.maxInvoices,
          required: false,
          type: 'number',
          defaultValue: '100',
          placeholder: '100',
        },
      ],
      requiredCapability: 'Invoicing',
    },
  ];
}

/** Build initial payload values from field defaults. */
function buildDefaultValues(fields: PayloadField[]): Record<string, string> {
  const defaults: Record<string, string> = {};
  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      defaults[field.name] = field.defaultValue;
    }
  }
  return defaults;
}

export function TriggerSyncDialog({
  connection,
  open,
  onOpenChange,
  submitDisabled = false,
  initialJobType,
  initialOrderScope = 'new',
}: TriggerSyncDialogProps): ReactElement {
  const copy = useMessages('sync-jobs').triggerSyncDialog;
  const adapters = useAdaptersQuery();
  const canImportRange =
    (
      adapters.data?.find((a) => a.adapterKey === connection.adapterKey) ??
      adapters.data?.find((a) => a.platformType === connection.platformType && a.isDefault)
    )?.orderWindowImport === true;
  const triggerableJobs = useMemo(
    () =>
      buildTriggerableJobs(copy).filter(
        (job) =>
          !job.requiredCapability ||
          connection.supportedCapabilities.includes(job.requiredCapability),
      ),
    [connection.supportedCapabilities, copy],
  );

  const [selectedJobType, setSelectedJobType] = useState(triggerableJobs[0]?.jobType ?? '');
  const [payloadValues, setPayloadValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [positionChoice, setPositionChoice] = useState(ORDER_POSITION_DEFAULT);
  const [customPositionKey, setCustomPositionKey] = useState('');
  const [orderRange, setOrderRange] = useState<OrderRangeValue>(ORDER_RANGE_DEFAULT_VALUE);
  // One "Sync orders" action with two scopes: the new orders since the last check, or
  // a range of days. They are two different jobs underneath, which an operator never sees.
  const [orderScope, setOrderScope] = useState<'new' | 'range'>('new');
  // A period chosen for the operator (from the Sync tab) pulses once so the choice is noticed.
  const [scopeHighlight, setScopeHighlight] = useState(false);
  const scopeTouched = useRef(false);
  // Stable idempotency-key suffix for this dialog open cycle. Reused across
  // retries after a failed submit so the backend dedup (Redis SET NX + DB
  // unique index on idempotency_key) collapses rapid double-clicks into a
  // single sync_jobs row. Re-minted each time the dialog is reopened so
  // genuinely distinct triggers remain distinct. See #369.
  const [intentKey, setIntentKey] = useState<string | null>(null);

  const enqueueSyncJob = useEnqueueSyncJobMutation();
  const { showToast } = useToast();

  const selectedJob = triggerableJobs.find((j) => j.jobType === selectedJobType);
  const isOrderSync = selectedJob?.jobType === 'marketplace.orders.poll';
  const isRangeImport = isOrderSync && canImportRange && orderScope === 'range';
  const submittedJobType = isRangeImport ? 'marketplace.orders.import' : selectedJob?.jobType;
  const hasTriggers = triggerableJobs.length > 0;

  useEffect(() => {
    if (open) {
      const firstJob =
        triggerableJobs.find((job) => job.jobType === initialJobType) ?? triggerableJobs[0];
      setSelectedJobType(firstJob?.jobType ?? '');
      setPayloadValues(
        firstJob ? buildDefaultValues(firstJob.payloadFields) : {},
      );
      setFieldErrors({});
      setPositionChoice(ORDER_POSITION_DEFAULT);
      setCustomPositionKey('');
      setOrderRange(ORDER_RANGE_DEFAULT_VALUE);
      setOrderScope('new');
      setScopeHighlight(false);
      scopeTouched.current = false;
      setIntentKey(crypto.randomUUID());
      enqueueSyncJob.reset();
    }
  }, [open]); // enqueueSyncJob.reset and triggerableJobs are intentionally excluded — stable on open only

  // The adapter list may land after the dialog opens, so the preselection waits for it.
  useEffect(() => {
    if (!open || !canImportRange || initialOrderScope !== 'range' || scopeTouched.current) return;
    setOrderScope('range');
    setScopeHighlight(true);
  }, [open, canImportRange, initialOrderScope]);

  const handleJobTypeChange = (jobType: string): void => {
    const job = triggerableJobs.find((j) => j.jobType === jobType);
    setSelectedJobType(jobType);
    setPayloadValues(job ? buildDefaultValues(job.payloadFields) : {});
    setFieldErrors({});
    setPositionChoice(ORDER_POSITION_DEFAULT);
    setCustomPositionKey('');
    setOrderRange(ORDER_RANGE_DEFAULT_VALUE);
    setOrderScope('new');
    scopeTouched.current = true;
    setScopeHighlight(false);
    enqueueSyncJob.reset();
  };

  const validate = (): boolean => {
    if (!selectedJob) return false;
    const errors: Record<string, string> = {};
    for (const field of isRangeImport ? [] : selectedJob.payloadFields) {
      if (field.required && !payloadValues[field.name]?.trim()) {
        errors[field.name] = interpolate(copy.fieldRequired, { field: field.label });
      }
    }
    if (
      isOrderSync &&
      !isRangeImport &&
      positionChoice === ORDER_POSITION_CUSTOM &&
      !customPositionKey.trim()
    ) {
      errors.cursorKey = copy.orderPosition.customRequired;
    }
    if (isRangeImport) {
      const problems = validateOrderRange(orderRange);
      if (problems.from) errors.from = copy.orderRange.errors[problems.from];
      if (problems.to) errors.to = copy.orderRange.errors[problems.to];
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (): Promise<void> => {
    if (!selectedJob || !validate() || intentKey === null) return;

    const payload: Record<string, unknown> =
      isRangeImport ? toOrderImportPayload(orderRange, intentKey) : { schemaVersion: 1 };
    for (const field of isRangeImport ? [] : selectedJob.payloadFields) {
      const raw = payloadValues[field.name]?.trim();
      if (raw) {
        payload[field.name] = field.type === 'number' ? Number(raw) : raw;
      }
    }

    if (isOrderSync && !isRangeImport) {
      const key = positionChoice === ORDER_POSITION_CUSTOM ? customPositionKey.trim() : positionChoice;
      if (key) payload.cursorKey = key;
    }

    try {
      const result = await enqueueSyncJob.mutateAsync({
        connectionId: connection.id,
        jobType: submittedJobType ?? selectedJob.jobType,
        payload,
        idempotencyKey: `manual:${connection.id}:${submittedJobType ?? selectedJob.jobType}:${intentKey}`,
      });

      onOpenChange(false);
      showToast({
        tone: 'success',
        title: copy.toast.title,
        description: interpolate(copy.toast.description, {
          job: selectedJob.label,
          connection: connection.name,
          jobId: result.jobId,
        }),
      });
    } catch {
      // Error displayed via enqueueSyncJob.error alert below.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="trigger-sync-dialog">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>
          {renderRich(
            copy.description,
            { strong: (chunks) => <strong>{chunks}</strong> },
            { connection: connection.name },
          )}{' '}
          <Link to="/jobs-logs" onClick={() => onOpenChange(false)} className="link">
            {copy.viewAllJobs}
          </Link>
        </DialogDescription>

        <div className="trigger-sync-dialog__body">
          {enqueueSyncJob.error ? (
            <Alert tone="error" title={copy.enqueueFailed}>
              {describeApiError(enqueueSyncJob.error, 'sync-jobs')}
            </Alert>
          ) : null}

          {!hasTriggers ? (
            <p className="trigger-sync-dialog__description muted-text" role="status">
              {copy.noTriggers}
            </p>
          ) : null}

          {hasTriggers ? (
            <FormField label={copy.jobType} name="jobType">
              <Select
                value={selectedJobType}
                onChange={(e) => handleJobTypeChange(e.target.value)}
                disabled={enqueueSyncJob.isPending}
              >
                {triggerableJobs.map((job) => (
                  <option key={job.jobType} value={job.jobType}>
                    {job.label}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}

          {selectedJob?.description ? (
            <p className="trigger-sync-dialog__description muted-text">{selectedJob.description}</p>
          ) : null}

          {isOrderSync && canImportRange ? (
            <div className={scopeHighlight ? 'trigger-sync-dialog__scope--preselected' : undefined}>
            <FormField
              label={copy.orderScope.label}
              name="orderScope"
              description={isRangeImport ? copy.orderScope.rangeHint : copy.orderScope.newHint}
            >
              <Select
                value={orderScope}
                onChange={(e) => {
                  scopeTouched.current = true;
                  setScopeHighlight(false);
                  setOrderScope(e.target.value === 'range' ? 'range' : 'new');
                }}
                disabled={enqueueSyncJob.isPending}
              >
                <option value="new">{copy.orderScope.new}</option>
                <option value="range">{copy.orderScope.range}</option>
              </Select>
            </FormField>
            </div>
          ) : null}

          {isOrderSync && !isRangeImport ? (
            <OrderPositionField
              connectionId={connection.id}
              choice={positionChoice}
              onChoiceChange={setPositionChoice}
              customKey={customPositionKey}
              onCustomKeyChange={setCustomPositionKey}
              customError={fieldErrors.cursorKey}
              disabled={enqueueSyncJob.isPending}
            />
          ) : null}

          {isRangeImport ? (
            <OrderRangeFields
              value={orderRange}
              onChange={setOrderRange}
              errors={{ from: fieldErrors.from, to: fieldErrors.to }}
              disabled={enqueueSyncJob.isPending}
            />
          ) : null}

          {(isRangeImport ? [] : (selectedJob?.payloadFields ?? [])).map((field) => (
            <FormField
              key={field.name}
              label={field.required ? interpolate(copy.requiredField, { field: field.label }) : field.label}
              name={field.name}
              error={fieldErrors[field.name]}
              description={field.description}
            >
              <Input
                value={payloadValues[field.name] ?? ''}
                onChange={(e) =>
                  setPayloadValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                }
                placeholder={field.placeholder}
                disabled={enqueueSyncJob.isPending}
                invalid={Boolean(fieldErrors[field.name])}
              />
            </FormField>
          ))}
        </div>

        <DialogFooter>
          <Button tone="secondary" onClick={() => onOpenChange(false)} disabled={enqueueSyncJob.isPending}>
            {copy.cancel}
          </Button>
          <ReadOnlyLock active={submitDisabled} message={demoReadOnlyActionMessage()}>
            <Button
              tone="primary"
              onClick={() => void handleSubmit()}
              disabled={
                enqueueSyncJob.isPending || intentKey === null || !hasTriggers || submitDisabled
              }
            >
              {enqueueSyncJob.isPending ? copy.enqueuing : copy.trigger}
            </Button>
          </ReadOnlyLock>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
