/**
 * Types for the KSeF UPO preview hook (#1234).
 *
 * @module features/invoicing/hooks
 */

export type ConfirmationPreviewKind = 'pdf' | 'xml' | 'unsupported';

export interface ConfirmationPreviewState {
  objectUrl: string;
  kind: ConfirmationPreviewKind;
}
