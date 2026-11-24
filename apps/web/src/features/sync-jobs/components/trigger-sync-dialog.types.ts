/**
 * TriggerSyncDialog Types
 *
 * Type definitions for the TriggerSyncDialog component, including payload field
 * configuration and job descriptors used to drive the sync job trigger form.
 *
 * @module apps/web/src/features/sync-jobs/components
 */
import type { CoreCapability, Connection } from '../../connections';

export interface PayloadField {
  name: string;
  label: string;
  required: boolean;
  placeholder?: string;
  /** Coerce non-empty string value to number before sending in payload. */
  type?: 'string' | 'number';
  /** Pre-populate the field with this value when the dialog opens. */
  defaultValue?: string;
  /** Help text shown under the field. */
  description?: string;
}

export interface TriggerableJob {
  jobType: string;
  label: string;
  description: string;
  payloadFields: PayloadField[];
  /**
   * If set, only show this job when the connection supports this capability.
   * Open-world at the extension boundary (mirrors the BE `CoreCapability |
   * string` shape, #576): manifests advertise sub-capability names beyond the
   * closed core set (e.g. `OfferEventReader`, #1498), and jobs may gate on
   * them. `string & Record<never, never>` keeps `CoreCapability`
   * autocomplete working.
   */
  requiredCapability?: CoreCapability | (string & Record<never, never>);
}

export interface TriggerSyncDialogProps {
  connection: Connection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Demo read-only viewer (#1615): the dialog opens with editable inputs, but
   * the final "Trigger" submit renders disabled with a read-only tooltip.
   */
  submitDisabled?: boolean;
  /** Job type to preselect when the dialog opens, if the connection offers it. */
  initialJobType?: string;
  /** Order sync scope to preselect when the dialog opens; honoured only where a period read exists. */
  initialOrderScope?: 'new' | 'range';
  /** The dialog opens after a guided jump from another tab, so it gets its own entrance. */
  guidedEntrance?: boolean;
}
