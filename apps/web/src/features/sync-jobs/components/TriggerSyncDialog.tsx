/**
 * Trigger Sync Dialog
 *
 * Modal dialog for manually enqueuing a sync job for a given connection.
 * Provides guided job-type selection, per-type payload forms, idempotency
 * key generation, and result feedback via toast.
 *
 * @module apps/web/src/features/sync-jobs/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
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
import type { PayloadField, TriggerableJob, TriggerSyncDialogProps } from './trigger-sync-dialog.types';

const ALL_TRIGGERABLE_JOBS: TriggerableJob[] = [
  {
    jobType: 'master.product.syncAll',
    label: 'Sync all products',
    description: 'Enumerate and sync every product from the source catalog.',
    payloadFields: [],
    requiredCapability: 'ProductMaster',
  },
  {
    jobType: 'master.product.syncByExternalId',
    label: 'Sync product by ID',
    description: 'Sync a single product using its external platform ID.',
    payloadFields: [
      { name: 'externalId', label: 'External ID', required: true },
      { name: 'objectType', label: 'Object type', required: false, placeholder: 'product' },
    ],
    requiredCapability: 'ProductMaster',
  },
  {
    jobType: 'master.inventory.syncAll',
    label: 'Sync all inventory',
    description: 'Enumerate and sync inventory levels for every product.',
    payloadFields: [],
    requiredCapability: 'InventoryMaster',
  },
  {
    jobType: 'master.inventory.syncByExternalId',
    label: 'Sync inventory by ID',
    description: 'Sync inventory for a single item using its external ID.',
    payloadFields: [
      { name: 'externalId', label: 'External ID', required: true },
      { name: 'objectType', label: 'Object type', required: false, placeholder: 'product' },
    ],
    requiredCapability: 'InventoryMaster',
  },
  {
    jobType: 'master.variants.autoMatch',
    label: 'Auto-match variants',
    description: 'Match product variants to marketplace offers by barcode.',
    payloadFields: [],
    requiredCapability: 'ProductMaster',
  },
  {
    jobType: 'marketplace.offers.sync',
    label: 'Sync marketplace offers',
    description: 'Pull offer listings from the marketplace.',
    payloadFields: [
      {
        name: 'limit',
        label: 'Page limit',
        required: false,
        type: 'number',
        defaultValue: '100',
        placeholder: '100',
      },
    ],
    requiredCapability: 'Marketplace',
  },
  {
    jobType: 'marketplace.orders.poll',
    label: 'Poll marketplace orders',
    description: 'Fetch new orders from the marketplace event stream.',
    payloadFields: [
      {
        name: 'cursorKey',
        label: 'Cursor key',
        required: false,
        defaultValueFactory: ({ platformType }) => `${platformType}.orders.lastEventId`,
      },
      {
        name: 'limit',
        label: 'Page limit',
        required: false,
        type: 'number',
        defaultValue: '100',
        placeholder: '100',
      },
    ],
    requiredCapability: 'Marketplace',
  },
  {
    jobType: 'inventory.propagateToMarketplaces',
    label: 'Propagate inventory to marketplaces',
    description: 'Push current inventory levels to all connected marketplaces.',
    payloadFields: [
      {
        name: 'productId',
        label: 'Product ID',
        required: true,
        placeholder: 'ol_product_…',
      },
    ],
    // No requiredCapability — this is a cross-connection fan-out job, valid for any active connection.
  },
];

/** Build initial payload values from field defaults. */
function buildDefaultValues(
  fields: PayloadField[],
  context: { platformType: string },
): Record<string, string> {
  const defaults: Record<string, string> = {};
  for (const field of fields) {
    if (field.defaultValueFactory !== undefined) {
      defaults[field.name] = field.defaultValueFactory(context);
    } else if (field.defaultValue !== undefined) {
      defaults[field.name] = field.defaultValue;
    }
  }
  return defaults;
}

export function TriggerSyncDialog({
  connection,
  open,
  onOpenChange,
}: TriggerSyncDialogProps): ReactElement {
  const triggerableJobs = useMemo(
    () =>
      ALL_TRIGGERABLE_JOBS.filter(
        (job) =>
          !job.requiredCapability ||
          connection.supportedCapabilities.includes(job.requiredCapability),
      ),
    [connection.supportedCapabilities],
  );

  const [selectedJobType, setSelectedJobType] = useState(triggerableJobs[0]?.jobType ?? '');
  const [payloadValues, setPayloadValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const enqueueSyncJob = useEnqueueSyncJobMutation();
  const { showToast } = useToast();

  const selectedJob = triggerableJobs.find((j) => j.jobType === selectedJobType);

  useEffect(() => {
    if (open) {
      const firstJob = triggerableJobs[0];
      setSelectedJobType(firstJob?.jobType ?? '');
      setPayloadValues(
        firstJob ? buildDefaultValues(firstJob.payloadFields, connection) : {},
      );
      setFieldErrors({});
      enqueueSyncJob.reset();
    }
  }, [open]); // enqueueSyncJob.reset and triggerableJobs are intentionally excluded — stable on open only

  const handleJobTypeChange = (jobType: string): void => {
    const job = triggerableJobs.find((j) => j.jobType === jobType);
    setSelectedJobType(jobType);
    setPayloadValues(job ? buildDefaultValues(job.payloadFields, connection) : {});
    setFieldErrors({});
    enqueueSyncJob.reset();
  };

  const validate = (): boolean => {
    if (!selectedJob) return false;
    const errors: Record<string, string> = {};
    for (const field of selectedJob.payloadFields) {
      if (field.required && !payloadValues[field.name]?.trim()) {
        errors[field.name] = `${field.label} is required`;
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (): Promise<void> => {
    if (!selectedJob || !validate()) return;

    const payload: Record<string, unknown> = { schemaVersion: 1 };
    for (const field of selectedJob.payloadFields) {
      const raw = payloadValues[field.name]?.trim();
      if (raw) {
        payload[field.name] = field.type === 'number' ? Number(raw) : raw;
      }
    }

    try {
      const result = await enqueueSyncJob.mutateAsync({
        connectionId: connection.id,
        jobType: selectedJob.jobType,
        payload,
        idempotencyKey: `manual:${connection.id}:${selectedJob.jobType}:${Date.now()}`,
      });

      onOpenChange(false);
      showToast({
        tone: 'success',
        title: 'Sync job enqueued',
        description: `"${selectedJob.label}" started for "${connection.name}". Job ID: ${result.jobId}`,
      });
    } catch {
      // Error displayed via enqueueSyncJob.error alert below.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="trigger-sync-dialog">
        <DialogTitle>Trigger sync</DialogTitle>
        <DialogDescription>
          Manually enqueue a sync job for <strong>{connection.name}</strong>.{' '}
          <Link to="/jobs-logs" onClick={() => onOpenChange(false)} className="link">
            View all jobs
          </Link>
        </DialogDescription>

        <div className="trigger-sync-dialog__body">
          {enqueueSyncJob.error ? (
            <Alert tone="error" title="Failed to enqueue job">
              {enqueueSyncJob.error.message}
            </Alert>
          ) : null}

          <FormField label="Job type" name="jobType">
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

          {selectedJob?.description ? (
            <p className="trigger-sync-dialog__description muted-text">{selectedJob.description}</p>
          ) : null}

          {selectedJob?.payloadFields.map((field) => (
            <FormField
              key={field.name}
              label={field.required ? `${field.label} *` : field.label}
              name={field.name}
              error={fieldErrors[field.name]}
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
            Cancel
          </Button>
          <Button
            tone="primary"
            onClick={() => void handleSubmit()}
            disabled={enqueueSyncJob.isPending}
          >
            {enqueueSyncJob.isPending ? 'Enqueuing…' : 'Trigger'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
