/**
 * Regulatory Verification Link Reader Capability
 *
 * Optional ADR-002 sub-capability of `InvoicingPort` (#3648). Some tax
 * authorities give every cleared document a public link that opens it in their
 * own portal (PL/KSeF: the "KOD I" verification link). A provider that cannot
 * render a document server-side can still offer that link as the thing a person
 * prints from, so it is a capability of its own rather than a document kind:
 * it is a URL, not bytes.
 *
 * Country-agnostic (ADR-026): core and every surface see only a neutral URL.
 * The host, path layout and any hash the link embeds stay behind the adapter.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoiceRecord } from '../../entities/invoice-record.entity';
import type { InvoicingPort } from '../invoicing.port';

export interface RegulatoryVerificationLink {
  url: string;
}

export interface RegulatoryVerificationLinkReader {
  /**
   * The public verification link for a cleared record, or `null` when one
   * cannot be built honestly (not cleared, or the inputs the link embeds were
   * not persisted). `null` is an answer, never a reason to guess a value.
   */
  getVerificationLink(record: InvoiceRecord): Promise<RegulatoryVerificationLink | null>;
}

export function isRegulatoryVerificationLinkReader(
  adapter: InvoicingPort,
): adapter is InvoicingPort & RegulatoryVerificationLinkReader {
  const candidate = adapter as Partial<RegulatoryVerificationLinkReader>;
  return typeof candidate.getVerificationLink === 'function';
}
