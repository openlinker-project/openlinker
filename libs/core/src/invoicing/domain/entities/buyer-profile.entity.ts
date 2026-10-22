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
import type {
  BuyerAddress,
  BuyerType,
  IssuedSnapshotBuyer,
  TaxIdentifier,
} from '../types/invoicing.types';

export class BuyerProfile {
  constructor(
    public readonly name: string,
    /** Scheme-tagged tax id; `null` when the buyer has none (typically B2C). */
    public readonly taxId: TaxIdentifier | null,
    public readonly address: BuyerAddress,
    public readonly type: BuyerType,
    /**
     * Buyer e-mail, when known (#1797). `null` when the order's source didn't
     * expose one — issuance must still succeed; only e-mail delivery
     * (`InvoiceEmailSender.sendByEmail`) needs it. Defaulted so every
     * pre-existing 4-argument call site keeps compiling unchanged.
     */
    public readonly email: string | null = null,
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
  /**
   * Rebuild the buyer an issued document carried, from its jsonb snapshot
   * (DEF-08). Every field travels: positional construction with four arguments
   * silently dropped the e-mail and the JST / VAT-group flags, so a correction
   * of a public-sector buyer's invoice declared it was not one. A pure factory
   * (ADR-011).
   */
  static fromSnapshot(buyer: IssuedSnapshotBuyer): BuyerProfile {
    return new BuyerProfile(
      buyer.name,
      buyer.taxId,
      buyer.address,
      buyer.type,
      buyer.email ?? null,
      buyer.isPublicSectorEntity,
      buyer.isVatGroupMember,
    );
  }

  get isCompany(): boolean {
    return this.type === 'company';
  }
}
