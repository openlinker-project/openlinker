/**
 * TriggerSyncDialog Types
 *
 * Type definitions for the TriggerSyncDialog component, including payload field
 * configuration and job descriptors used to drive the sync job trigger form.
 *
 * @module apps/web/src/features/sync-jobs/components
 */
import type { CoreCapability, Connection } from '../../connections/api/connections.types';

export interface PayloadField {
  name: string;
  label: string;
  required: boolean;
  placeholder?: string;
  /** Coerce non-empty string value to number before sending in payload. */
  type?: 'string' | 'number';
  /** Pre-populate the field with this value when the dialog opens. */
  defaultValue?: string;
  /**
   * Derive the default value from connection context (takes precedence over defaultValue).
   * Used when the default depends on the platform type (e.g. cursorKey).
   */
  defaultValueFactory?: (context: { platformType: string }) => string;
}

export interface TriggerableJob {
  jobType: string;
  label: string;
  description: string;
  payloadFields: PayloadField[];
  /** If set, only show this job when the connection supports this capability. */
  requiredCapability?: CoreCapability;
}

export interface TriggerSyncDialogProps {
  connection: Connection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
