/**
 * Types for the KSeF UPO preview hook (#1234).
 *
 * @module features/invoicing/hooks
 */

export type UpoPreviewKind = 'pdf' | 'xml' | 'unsupported';

export interface UpoPreviewState {
  objectUrl: string;
  kind: UpoPreviewKind;
}
