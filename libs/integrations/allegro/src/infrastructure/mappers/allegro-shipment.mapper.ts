/**
 * Allegro Shipment Mapper (#833)
 *
 * Pure translation between the neutral core shipping contract
 * (`GenerateLabelCommand` / `GenerateLabelResult` / `ShipmentStatus`) and the
 * Allegro `/shipment-management/*` wire shapes. No I/O — the adapter owns HTTP.
 *
 * @module libs/integrations/allegro/src/infrastructure/mappers
 */
import { createHash } from 'node:crypto';

import type {
  GenerateLabelCommand,
  GenerateLabelResult,
  ShipmentRecipient,
  ShipmentStatus,
} from '@openlinker/core/shipping';

import { AllegroShipmentRejectedException } from '../../domain/exceptions/allegro-shipment-rejected.exception';
import type {
  AllegroCreateShipmentInput,
  AllegroShipmentCommandError,
  AllegroShipmentParty,
  AllegroShipmentResource,
} from '../../domain/types/allegro-shipment.types';
import {
  ALLEGRO_SHIPMENT_DIMENSION_UNIT,
  ALLEGRO_SHIPMENT_LABEL_FORMAT,
  ALLEGRO_SHIPMENT_PACKAGE_TYPE,
  ALLEGRO_SHIPMENT_WEIGHT_UNIT,
} from '../../domain/types/allegro-shipment.types';

/**
 * Opaque `labelPdfRef` prefix; a future label-download endpoint resolves it via
 * `POST /shipment-management/label`. Follows the implicit cross-provider
 * `{provider}:label:{id}` convention (InPost uses `shipx:label:{id}`) — when the
 * deferred cross-provider `LabelDocumentReader` vertical lands, hoist a shared
 * ref-format helper so the parse/format sides can't drift.
 */
const LABEL_REF_PREFIX = 'allegro-delivery:label:';

/**
 * Deterministic client `commandId` (UUID-shaped) derived from a stable seed —
 * the shipment id for create, `cancel:{providerShipmentId}` for cancel. Stable
 * across retries of the same attempt (Allegro dedups on `commandId`), so a
 * re-derivation by a reconciler (#838) hits the same command; a genuine
 * re-issue is a new shipment id → a new command. Not RFC-strict v5 (no fixed
 * namespace) but a stable, collision-resistant, valid-format UUID per seed.
 */
export function deriveCommandId(seed: string): string {
  const hex = createHash('sha1').update(`allegro-shipment:${seed}`).digest('hex').slice(0, 32);
  const chars = hex.split('');
  chars[12] = '5'; // version nibble
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16); // variant
  const s = chars.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

function resolveReceiverName(recipient: ShipmentRecipient): string | undefined {
  if (recipient.name) {
    return recipient.name;
  }
  const joined = [recipient.firstName, recipient.lastName].filter(Boolean).join(' ').trim();
  return joined.length > 0 ? joined : undefined;
}

/** mm → cm (Allegro `CENTIMETER`), one decimal to avoid float noise. */
function mmToCm(mm: number): number {
  return Number((mm / 10).toFixed(1));
}

/** grams → kg (Allegro `KILOGRAMS`), three decimals (1 g precision). */
function gramsToKg(grams: number): number {
  return Number((grams / 1000).toFixed(3));
}

/**
 * Build the `input` for `POST /shipment-management/shipments/create-commands`.
 * Throws `AllegroShipmentRejectedException` (readable) on pre-flight gaps the
 * Allegro create requires: the resolved provider delivery-method id, and
 * parcel dimensions + weight (Allegro has no locker size-template abstraction,
 * so dimensions are mandatory — see #833 Q7). `sender` is intentionally omitted
 * — Allegro brokers "Wysyłam z Allegro" and defaults the sender from the seller
 * account (#833 Q6); if a sandbox probe shows it required, add it here.
 */
export function buildCreateShipmentInput(cmd: GenerateLabelCommand): AllegroCreateShipmentInput {
  if (!cmd.deliveryMethodId) {
    throw new AllegroShipmentRejectedException(
      `No Allegro delivery-method id resolved for shipment ${cmd.shipmentId}; ` +
        `route the order method to an Allegro Delivery service before generating a label`,
    );
  }

  const { dimensions, weightGrams } = cmd.parcel;
  if (!dimensions || weightGrams === undefined || weightGrams === null) {
    throw new AllegroShipmentRejectedException(
      `Allegro Delivery requires parcel dimensions (length/width/height) and weight ` +
        `for shipment ${cmd.shipmentId}`,
    );
  }

  const address = cmd.recipient.address;
  const receiver: AllegroShipmentParty = {
    name: resolveReceiverName(cmd.recipient),
    email: cmd.recipient.email,
    phone: cmd.recipient.phone,
    ...(address
      ? {
          street: `${address.street} ${address.buildingNumber}`.trim(),
          postalCode: address.postCode,
          city: address.city,
          countryCode: address.countryCode,
        }
      : {}),
    ...(cmd.paczkomatId ? { point: cmd.paczkomatId } : {}),
  };

  return {
    deliveryMethodId: cmd.deliveryMethodId,
    receiver,
    referenceNumber: cmd.shipmentId,
    packages: [
      {
        type: ALLEGRO_SHIPMENT_PACKAGE_TYPE,
        length: { value: mmToCm(dimensions.length), unit: ALLEGRO_SHIPMENT_DIMENSION_UNIT },
        width: { value: mmToCm(dimensions.width), unit: ALLEGRO_SHIPMENT_DIMENSION_UNIT },
        height: { value: mmToCm(dimensions.height), unit: ALLEGRO_SHIPMENT_DIMENSION_UNIT },
        weight: { value: gramsToKg(weightGrams), unit: ALLEGRO_SHIPMENT_WEIGHT_UNIT },
      },
    ],
    labelFormat: ALLEGRO_SHIPMENT_LABEL_FORMAT,
  };
}

/** Opaque `labelPdfRef` carrying the provider shipment id for later resolution. */
export function toGenerateLabelResult(shipmentId: string): GenerateLabelResult {
  return {
    providerShipmentId: shipmentId,
    // Allegro issues the carrier waybill asynchronously; #838's status sync
    // backfills tracking via `getTracking`. Null at create time.
    trackingNumber: null,
    labelPdfRef: `${LABEL_REF_PREFIX}${shipmentId}`,
  };
}

function hasCarrierWaybill(resource: AllegroShipmentResource): boolean {
  return extractCarrierWaybill(resource) !== undefined;
}

/**
 * Pick the first non-empty `transportingInfo[].carrierWaybill` across packages,
 * in document order — Allegro doesn't promise multi-package determinism, but
 * iterating in array order is stable across polls of the same shipment and
 * matches `hasCarrierWaybill`'s scan. Falls back to `undefined` when none is
 * assigned yet.
 *
 * Consumed by `getTracking` (#838) to populate
 * `TrackingSnapshot.trackingNumber`, which the core status-sync service
 * backfills onto `Shipment.trackingNumber` and projects to the destination
 * OMP.
 */
export function extractCarrierWaybill(resource: AllegroShipmentResource): string | undefined {
  for (const pkg of resource.packages ?? []) {
    for (const t of pkg.transportingInfo ?? []) {
      if (t.carrierWaybill && t.carrierWaybill.length > 0) {
        return t.carrierWaybill;
      }
    }
  }
  return undefined;
}

/**
 * Coarse `ShipmentStatus` derivation from the shipment resource. The
 * shipment-management resource exposes no lifecycle enum, so #833 derives only
 * what's structurally knowable: `canceled` → `cancelled`; a carrier waybill
 * present → `dispatched`; otherwise `generated`. Rich carrier-tracking
 * transitions (in-transit / delivered) come from #838's carrier-tracking poll.
 *
 * NOTE for #838: Allegro assigns the waybill at/near shipment creation — i.e.
 * *before* physical handover — so this coarse `waybill → dispatched` reading is
 * a placeholder. Do NOT blindly advance `generated → dispatched` on it; gate the
 * real transition on a carrier-tracking pickup event so the operator's "packed /
 * awaiting dispatch" (`generated`) state isn't collapsed.
 */
export function mapShipmentStateToStatus(resource: AllegroShipmentResource): ShipmentStatus {
  if (resource.canceledDate) {
    return 'cancelled';
  }
  if (hasCarrierWaybill(resource)) {
    return 'dispatched';
  }
  return 'generated';
}

/** Short diagnostic string for `TrackingSnapshot.providerStatus`. */
export function describeShipmentState(resource: AllegroShipmentResource): string {
  if (resource.canceledDate) {
    return 'canceled';
  }
  return hasCarrierWaybill(resource) ? 'waybill-assigned' : 'created';
}

/** Flatten structured Allegro command errors into a readable single line. */
export function formatCommandErrors(errors: readonly AllegroShipmentCommandError[] | undefined): string {
  if (!errors || errors.length === 0) {
    return 'Allegro returned no error detail';
  }
  return errors
    .map((e) => e.userMessage ?? e.message ?? e.code ?? 'unknown error')
    .join('; ');
}
