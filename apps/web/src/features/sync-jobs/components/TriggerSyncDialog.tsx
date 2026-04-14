/**
 * Trigger Sync Dialog
 *
 * Modal dialog for manually enqueuing a sync job for a given connection.
 * Provides guided job-type selection, per-type payload forms, idempotency
 * key generation, and result feedback via toast.
 *
 * @module apps/web/src/features/sync-jobs/components
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { Capability, Connection } from '../../connections/api/connections.types';
import { useEnqueueSyncJobMutation } from '../hooks/use-enqueue-sync-job-mutation';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';

interface PayloadField {
  name: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

interface TriggerableJob {
  jobType: string;
  label: string;
  description: string;
  payloadFields: PayloadField[];
  /** If set, only show this job when the connection supports this capability. */
  requiredCapability?: Capability;
}

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
    payloadFields: [],
    requiredCapability: 'Marketplace',
  },
  {
    jobType: 'inventory.propagateToMarketplaces',
    label: 'Propagate inventory to marketplaces',
    description: 'Push current inventory levels to all connected marketplaces.',
    payloadFields: [],
    // No requiredCapability — this is a cross-connection fan-out job, valid for any active connection.
  },
];

interface TriggerSyncDialogProps {
  connection: Connection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TriggerSyncDialog({
  connection,
  open,
  onOpenChange,
}: TriggerSyncDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

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

  // selectedJobType is always sourced from triggerableJobs, so the find always succeeds.
  const selectedJob = triggerableJobs.find((j) => j.jobType === selectedJobType);

  // showModal/close handle focus trapping, Escape key, and focus restoration natively
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Reset form state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedJobType(triggerableJobs[0]?.jobType ?? '');
      setPayloadValues({});
      setFieldErrors({});
      enqueueSyncJob.reset();
    }
  }, [open]); // enqueueSyncJob.reset and triggerableJobs are intentionally excluded — stable on open only

  // Sync controlled state with native cancel event (Escape key)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (event: Event): void => {
      event.preventDefault();
      onOpenChange(false);
    };

    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
    };
  }, [onOpenChange]);

  const handleJobTypeChange = (jobType: string): void => {
    setSelectedJobType(jobType);
    setPayloadValues({});
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
      const value = payloadValues[field.name]?.trim();
      if (value) {
        payload[field.name] = value;
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
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="dialog trigger-sync-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div className="dialog__header">
        <h2 id={titleId} className="dialog__title">
          Trigger sync
        </h2>
        <p id={descriptionId} className="dialog__subtitle muted-text">
          Manually enqueue a sync job for <strong>{connection.name}</strong>.{' '}
          <Link to="/jobs-logs" onClick={() => onOpenChange(false)} className="link">
            View all jobs
          </Link>
        </p>
      </div>

      <div className="dialog__body">
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

      <div className="dialog__actions">
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
      </div>
    </dialog>
  );
}
