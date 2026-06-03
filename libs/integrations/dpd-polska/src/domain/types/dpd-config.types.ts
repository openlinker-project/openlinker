/**
 * DPD Polska Connection Config Types
 *
 * Non-secret per-connection configuration: the DPDServices environment, the
 * payer FID (the customer's account sub-number sent in every request body —
 * non-secret, analogous to InPost's `organizationId`), the optional
 * `masterFid` (provisional, for the `X-DPD-FID` header pending OQ-2 in the
 * #962 plan), and the sender block used as the DPD shipment `sender`.
 *
 * The sender `address` is a single line here to match DPD's flat
 * `SenderOrReceiver.address` field; the recipient's split `ShipmentAddress`
 * (`street` + `buildingNumber`) is concatenated in the mapper.
 *
 * Validated at the boundary by the connection-config shape validator
 * (`class-validator` DTO). `login` / `password` are the secret half and live
 * in credentials, not here.
 *
 * @module libs/integrations/dpd-polska/src/domain/types
 */

export const DpdEnvironmentValues = ['sandbox', 'production'] as const;
export type DpdEnvironment = (typeof DpdEnvironmentValues)[number];

/** Sender block — maps to a DPD `sender` SenderOrReceiver. */
export interface DpdSenderContact {
  company?: string;
  name?: string;
  /** Single-line street address (DPD `address`, ≤100). */
  address: string;
  city: string;
  /** PL postal code `NN-NNN`. */
  postalCode: string;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  phone?: string;
  email?: string;
}

export interface DpdConnectionConfig {
  environment: DpdEnvironment;
  /** Payer FID sub-number (numkat/fid) — numeric string, sent as `payerFID`. */
  payerFid: string;
  /** Provisional master FID for the `X-DPD-FID` header (OQ-2). Numeric string. */
  masterFid?: string;
  /** Sender — populates the DPD `sender` on every shipment. */
  senderAddress: DpdSenderContact;
}
