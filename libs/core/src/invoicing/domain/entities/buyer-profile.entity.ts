/**
 * Buyer Profile — Domain Entity
 *
 * The party an invoice is issued to. Country-agnostic: the tax identity is a
 * scheme-tagged {@link TaxIdentifier} (`pl-nip`/`eu-vat`/…), never a bare NIP.
 * `type` (company/private) and `taxId` presence are *inputs* a future rules
 * layer reads to choose the document type — the choice is not made here
 * (ADR-026). Plain class, no framework decorators.
 *
 * @module libs/core/src/invoicing/domain/entities
 */
import type { BuyerAddress, BuyerType, TaxIdentifier } from '../types/invoicing.types';

export class BuyerProfile {
  constructor(
    public readonly name: string,
    /** Scheme-tagged tax id; `null` when the buyer has none (typically B2C). */
    public readonly taxId: TaxIdentifier | null,
    public readonly address: BuyerAddress,
    public readonly type: BuyerType,
  ) {}

  /** Pure derivation: a business buyer (B2B). No I/O, no mutation. */
  get isCompany(): boolean {
    return this.type === 'company';
  }
}
