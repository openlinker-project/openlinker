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
    /**
     * Optional operator-supplied fiscal classification (#1580). Neutral,
     * country-agnostic flags a provider maps to its regime (a KSeF adapter maps
     * them to the FA(3) `JST`/`GV` party flags): `isPublicSectorEntity` = the
     * buyer is a local-government / public-sector unit; `isVatGroupMember` = the
     * buyer belongs to a VAT group. Trailing + optional so every existing
     * 4-arg `new BuyerProfile(...)` call is unaffected; absent ⇒ the provider
     * emits its "does not apply" default. Core never interprets them (ADR-026).
     */
    public readonly isPublicSectorEntity?: boolean,
    public readonly isVatGroupMember?: boolean,
  ) {}

  /** Pure derivation: a business buyer (B2B). No I/O, no mutation. */
  get isCompany(): boolean {
    return this.type === 'company';
  }
}
