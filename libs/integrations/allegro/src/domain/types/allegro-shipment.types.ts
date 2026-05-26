/**
 * Allegro `/shipment-management/*` Wire Types (#833)
 *
 * Request/response shapes for "Wysyłam z Allegro" (Allegro Delivery / Allegro
 * One) shipment management. Mapped to/from the neutral core shipping contract
 * by `allegro-shipment.mapper.ts`; the adapter never leaks these outward.
 *
 * Confidence: paths + the `{ commandId, input }` create-command wrapper are
 * `confirmed-by-docs` (Allegro tutorial + allegro/allegro-api#12047). Exact
 * enum/unit spellings are `partial` / `needs-sandbox-probe` — each is isolated
 * to a single named constant below so a sandbox correction is a one-line edit
 * (the R1 / OQ-B2 mitigation from the #732 spec).
 *
 * @module libs/integrations/allegro/src/domain/types
 */

/**
 * Async-command lifecycle status returned by the create/cancel command poll.
 * `needs-sandbox-probe` (#833 OQ-B2): documented as IN_PROGRESS/SUCCESS/ERROR;
 * verify the exact spellings against the sandbox before trusting in prod.
 */
export const AllegroShipmentCommandStatusValues = ['IN_PROGRESS', 'SUCCESS', 'ERROR'] as const;
export type AllegroShipmentCommandStatus = (typeof AllegroShipmentCommandStatusValues)[number];

/**
 * Dimension/weight unit literals on `packages[]`. `needs-sandbox-probe` (#833
 * OQ-B2/B4) — documented as CENTIMETER/KILOGRAMS; isolated here so a unit
 * mismatch is a one-line fix.
 */
export const ALLEGRO_SHIPMENT_DIMENSION_UNIT = 'CENTIMETER';
export const ALLEGRO_SHIPMENT_WEIGHT_UNIT = 'KILOGRAMS';

/** Default package `type`; DOX/PALLET/OTHER are edge cases not modelled in v1. */
export const ALLEGRO_SHIPMENT_PACKAGE_TYPE = 'PACKAGE';

/** Label format chosen at create time (immutable after). v1 = PDF only. */
export const ALLEGRO_SHIPMENT_LABEL_FORMAT = 'PDF';

/** A sender/receiver party on a create-command. `point` carries a pickup-point id. */
export interface AllegroShipmentParty {
  name?: string;
  company?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  email?: string;
  phone?: string;
  /** Pickup-point id (paczkomat / Allegro One Box) for point-delivery methods. */
  point?: string;
}

export interface AllegroShipmentMeasure {
  value: number;
  unit: string;
}

export interface AllegroShipmentPackageInput {
  type: string;
  length: AllegroShipmentMeasure;
  width: AllegroShipmentMeasure;
  height: AllegroShipmentMeasure;
  weight: AllegroShipmentMeasure;
  textOnLabel?: string;
}

/** Body of `POST /shipment-management/shipments/create-commands` → `input`. */
export interface AllegroCreateShipmentInput {
  deliveryMethodId: string;
  receiver: AllegroShipmentParty;
  sender?: AllegroShipmentParty;
  referenceNumber?: string;
  packages: readonly AllegroShipmentPackageInput[];
  labelFormat: string;
}

export interface AllegroCreateShipmentCommandRequest {
  commandId: string;
  input: AllegroCreateShipmentInput;
}

export interface AllegroShipmentCommandError {
  code?: string;
  message?: string;
  userMessage?: string;
  path?: string;
}

/**
 * Response of `GET .../create-commands/{commandId}` (and the cancel-command
 * poll — same shape). `shipmentId` is present once `status === 'SUCCESS'`.
 */
export interface AllegroShipmentCommandResult {
  commandId: string;
  status: AllegroShipmentCommandStatus;
  shipmentId?: string;
  errors?: readonly AllegroShipmentCommandError[];
}

export interface AllegroCancelShipmentCommandRequest {
  commandId: string;
  input: { shipmentId: string };
}

export interface AllegroShipmentTransportingInfo {
  carrierId?: string;
  carrierWaybill?: string;
}

export interface AllegroShipmentPackage {
  waybill?: string;
  transportingInfo?: readonly AllegroShipmentTransportingInfo[];
}

/** Response of `GET /shipment-management/shipments/{shipmentId}`. */
export interface AllegroShipmentResource {
  id: string;
  packages?: readonly AllegroShipmentPackage[];
  canceledDate?: string | null;
  createdDate?: string;
}

/**
 * Bounded inline-poll knobs for the async create/cancel command. The poll is
 * intentionally bounded: a create that doesn't resolve within the budget
 * surfaces as a retriable failure (#833 Q4) and the durable `pending`
 * lifecycle is #838's. Overridable via the adapter constructor.
 */
export interface AllegroShipmentPollConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

export const DEFAULT_ALLEGRO_SHIPMENT_POLL_CONFIG: AllegroShipmentPollConfig = {
  maxAttempts: 8,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffFactor: 2,
};
