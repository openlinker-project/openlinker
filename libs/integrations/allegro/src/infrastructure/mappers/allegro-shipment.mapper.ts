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

import { ShippingProviderRejectionException } from '@openlinker/core/shipping';
import type { AllegroSenderContact } from '../../domain/types/allegro-config.types';
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
 * Throws `ShippingProviderRejectionException` (readable) on pre-flight gaps
 * the Allegro create requires: the resolved provider delivery-method id, and
 * parcel dimensions + weight (Allegro has no locker size-template abstraction,
 * so dimensions are mandatory — see #833 Q7), and the sender. `sender` IS required
 * by Allegro's create-command (live sandbox probe: 400 `input.sender`; the
 * original assumption that Allegro defaults it from the seller account was
 * wrong), so it comes from the connection's `senderAddress`.
 */
export function buildCreateShipmentInput(
  cmd: GenerateLabelCommand,
  sender: AllegroSenderContact | null,
): AllegroCreateShipmentInput {
  if (!sender) {
    throw new ShippingProviderRejectionException(
      'allegro',
      'preflight.missing-sender-address',
      `The Allegro connection has no sender address (config.senderAddress); ` +
        `Allegro Delivery requires one to create shipment ${cmd.shipmentId}`,
    );
  }

  if (!cmd.deliveryMethodId) {
    throw new ShippingProviderRejectionException(
      'allegro',
      'preflight.missing-delivery-method-id',
      `No Allegro delivery-method id resolved for shipment ${cmd.shipmentId}; ` +
        `route the order method to an Allegro Delivery service before generating a label`,
    );
  }

  const { dimensions, weightGrams } = cmd.parcel;
  if (!dimensions || weightGrams === undefined || weightGrams === null) {
    throw new ShippingProviderRejectionException(
      'allegro',
      'preflight.missing-parcel-dimensions',
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

  const senderParty: AllegroShipmentParty = {
    ...(sender.name ? { name: sender.name } : {}),
    ...(sender.company ? { company: sender.company } : {}),
    email: sender.email,
    phone: sender.phone,
    street: `${sender.address.street} ${sender.address.buildingNumber}`.trim(),
    postalCode: sender.address.postCode,
    city: sender.address.city,
    countryCode: sender.address.countryCode,
  };

  return {
    deliveryMethodId: cmd.deliveryMethodId,
    receiver,
    sender: senderParty,
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
 * Map Allegro's wire-shape `carrierId` enum (UPPER_SNAKE_CASE) to OL's
 * canonical lowercase-kebab vocabulary (`KnownCarrier`, see
 * `tracking-snapshot.types.ts`). Unknown values fall through unmapped — the
 * FE gracefully renders no link for any value not in the static URL map, so a
 * missing mapping here is a soft failure.
 *
 * Vocabulary sourced from product-spec #732 §3.2. If Allegro adds a new
 * carrier id, the test in `allegro-shipment.mapper.spec.ts` catches the
 * unknown-value passthrough; appending a new mapping entry + adding the
 * corresponding `KnownCarrierValues` entry in core is a two-line edit.
 */
const ALLEGRO_CARRIER_ID_MAP: Record<string, string> = {
  INPOST: 'inpost',
  DPD: 'dpd',
  DHL: 'dhl',
  ORLEN: 'orlen',
  ORLEN_PACZKA: 'orlen',
  ALLEGRO_ONE_BOX: 'allegro-one-box',
  ALLEGRO_ONE_PUNKT: 'allegro-one-punkt',
  ALLEGRO_ONE_KURIER: 'allegro-one-kurier',
  POCZTA: 'poczta-polska',
  POCZTA_POLSKA: 'poczta-polska',
  UPS: 'ups',
  PACKETA: 'packeta',
};

export function normalizeAllegroCarrierId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return ALLEGRO_CARRIER_ID_MAP[raw] ?? raw.toLowerCase();
}

/**
 * Pick the first non-empty `transportingInfo[].carrierId` across packages, in
 * document order (matches `extractCarrierWaybill`'s scan). Returns the
 * normalized canonical-form value when found, `undefined` otherwise.
 *
 * Consumed by `getTracking` (#769) to populate `TrackingSnapshot.carrier` —
 * the core status-sync service backfills it onto `Shipment.carrier` and the
 * FE keys public-tracker URLs against it. Allegro Delivery's brokered
 * carrier identity (InPost / DPD / ORLEN / …) arrives asynchronously
 * alongside the carrier waybill, so this returns `undefined` until the first
 * post-create poll surfaces it.
 */
export function extractCarrierId(resource: AllegroShipmentResource): string | undefined {
  for (const pkg of resource.packages ?? []) {
    for (const t of pkg.transportingInfo ?? []) {
      if (t.carrierId) {
        return normalizeAllegroCarrierId(t.carrierId);
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

/**
 * Read the connection's sender from its untyped config blob. Returns `null`
 * unless every field Allegro requires is present - a half-filled sender sent to
 * Allegro would be rejected with a less useful message than the pre-call refusal.
 */
export function readAllegroSender(config: Record<string, unknown> | undefined): AllegroSenderContact | null {
  const raw = config?.senderAddress;
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const sender = raw as Record<string, unknown>;
  const address = sender.address;
  if (typeof address !== 'object' || address === null) {
    return null;
  }
  const a = address as Record<string, unknown>;
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

  const email = text(sender.email);
  const phone = text(sender.phone);
  const street = text(a.street);
  const buildingNumber = text(a.buildingNumber);
  const city = text(a.city);
  const postCode = text(a.postCode);
  const countryCode = text(a.countryCode);
  if (!email || !phone || !street || !buildingNumber || !city || !postCode || !countryCode) {
    return null;
  }
  const name = text(sender.name);
  const company = text(sender.company);
  return {
    ...(name ? { name } : {}),
    ...(company ? { company } : {}),
    email,
    phone,
    address: { street, buildingNumber, city, postCode, countryCode },
  };
}
