/**
 * InPost ShipX Mapper
 *
 * Pure translation between the carrier-neutral `@openlinker/core/shipping`
 * types and the ShipX wire shapes. The single seam where ShipX field names,
 * the `service` discriminator, the parcel object-vs-array split, and the full
 * status code table live — keeping the adapter free of wire-format detail.
 *
 * All functions are pure (no I/O, no logging). The unknown-status policy is
 * expressed by `mapShipXStatus` returning `null`; the adapter logs the WARN
 * and falls back to a non-terminal status (it owns the logger).
 *
 * @module libs/integrations/inpost/src/infrastructure/mappers
 */
import type {
  GenerateLabelCommand,
  GenerateLabelResult,
  ShipmentStatus,
  ShipmentAddress,
  TrackingSnapshot,
  PickupPoint,
  PickupPointAddress,
  PickupPointStatus,
  PickupPointType,
  FindPickupPointsQuery,
} from '@openlinker/core/shipping';
import { PICKUP_POINT_STATUS, PICKUP_POINT_TYPE } from '@openlinker/core/shipping';
import type { InpostConnectionConfig, InpostSenderContact } from '../../domain/types/inpost-config.types';
import type {
  ShipXAddress,
  ShipXCreateShipmentRequest,
  ShipXPeer,
  ShipXPoint,
  ShipXShipment,
} from '../../domain/types/inpost-shipx.types';
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';

/**
 * Full ShipX status → OpenLinker bucket table (verified against the ShipX
 * "Statuses" doc). Codes absent here are unknown → `mapShipXStatus` returns
 * `null` and the adapter maps them to a non-terminal `in-transit` + WARN.
 */
const SHIPX_STATUS_TO_OL: Readonly<Record<string, ShipmentStatus>> = {
  // Pre-dispatch (created → ready-for-handoff) → label exists / generated.
  created: 'generated',
  offers_prepared: 'generated',
  offer_selected: 'generated',
  confirmed: 'generated',
  // Handed off to InPost.
  dispatched_by_sender: 'dispatched',
  dispatched_by_sender_to_pok: 'dispatched',
  collected_from_sender: 'dispatched',
  taken_by_courier: 'dispatched',
  taken_by_courier_from_pok: 'dispatched',
  adopted_at_source_branch: 'dispatched',
  sent_from_source_branch: 'dispatched',
  adopted_at_sorting_center: 'dispatched',
  taken_by_courier_from_customer_service_point: 'dispatched',
  // In the network / out for delivery / awaiting pickup.
  out_for_delivery: 'in-transit',
  out_for_delivery_to_address: 'in-transit',
  ready_to_pickup: 'in-transit',
  ready_to_pickup_from_pok: 'in-transit',
  ready_to_pickup_from_branch: 'in-transit',
  pickup_reminder_sent: 'in-transit',
  pickup_reminder_sent_address: 'in-transit',
  avizo: 'in-transit',
  readdressed: 'in-transit',
  redirect_to_box: 'in-transit',
  oversized: 'in-transit',
  delay_in_delivery: 'in-transit',
  stack_in_customer_service_point: 'in-transit',
  unstack_from_customer_service_point: 'in-transit',
  courier_avizo_in_customer_service_point: 'in-transit',
  stack_in_box_machine: 'in-transit',
  unstack_from_box_machine: 'in-transit',
  claimed: 'in-transit',
  // Terminal — delivered.
  delivered: 'delivered',
  // Terminal — cancelled.
  canceled: 'cancelled',
  canceled_redirect_to_box: 'cancelled',
  // Terminal — non-delivery outcomes.
  returned_to_sender: 'failed',
  rejected_by_receiver: 'failed',
  undelivered: 'failed',
  undelivered_wrong_address: 'failed',
  undelivered_cod_cash_receiver: 'failed',
  pickup_time_expired: 'failed',
  stack_parcel_pickup_time_expired: 'failed',
  stack_parcel_in_box_machine_pickup_time_expired: 'failed',
};

/** Maps a raw ShipX status to an OL bucket; `null` for unknown codes. */
export function mapShipXStatus(raw: string): ShipmentStatus | null {
  return SHIPX_STATUS_TO_OL[raw] ?? null;
}

/** Build the simplified-mode create-shipment request for the command's method. */
export function buildCreateShipmentRequest(
  cmd: GenerateLabelCommand,
  config: InpostConnectionConfig,
): ShipXCreateShipmentRequest {
  const sender = toSenderPeer(config.senderAddress);

  if (cmd.shippingMethod === 'paczkomat') {
    return buildLockerRequest(cmd, sender);
  }
  if (cmd.shippingMethod === 'kurier') {
    return buildCourierRequest(cmd, sender);
  }
  throw new ShippingProviderRejectionException(
    'inpost',
    'preflight.unsupported-method',
    `Unsupported shipping method: ${String(cmd.shippingMethod)}`,
  );
}

/** Map a ShipX shipment (create response / shipment-by-id) to the port result. */
export function toGenerateLabelResult(shipment: ShipXShipment): GenerateLabelResult {
  return {
    providerShipmentId: String(shipment.id),
    trackingNumber: shipment.tracking_number,
    labelPdfRef: `shipx:label:${shipment.id}`,
  };
}

/**
 * Build a tracking snapshot from the already-mapped status + the raw ShipX
 * code. v1 reads status from `GET /v1/shipments/:id`, which doesn't carry the
 * `tracking_details` timeline, so `dispatchedAt` / `deliveredAt` are left
 * unset (the tracking-number timeline endpoint is unavailable in sandbox).
 *
 * `carrier` is always `'inpost'` for this adapter (own-contract InPost
 * shipments; no brokerage layer to disambiguate, unlike Allegro Delivery —
 * see `KnownCarrierValues` in core).
 */
export function toTrackingSnapshot(status: ShipmentStatus, providerStatus: string): TrackingSnapshot {
  return { status, providerStatus, carrier: 'inpost' };
}

/** Map a ShipX point to the neutral `PickupPoint`. */
export function toPickupPoint(point: ShipXPoint): PickupPoint {
  const type = normalizePointTypeTokens(point.type);
  const result: PickupPoint = {
    providerId: point.name,
    name: point.name,
    address: toPickupPointAddress(point),
    status: mapPickupPointStatus(point.status),
    lat: point.location?.latitude,
    lon: point.location?.longitude,
    pointType: classifyInpostPointType({ id: point.name, name: point.display_name, type }),
  };
  if (type !== undefined) {
    result.type = type;
  }
  return result;
}

/**
 * Classify an InPost pickup point as a Paczkomat (`apm`) or a PaczkoPunkt
 * (`pop`), #1433.
 *
 * Authoritative when the ShipX `type` list is present: a list carrying `pop`
 * or `parcel_locker_superpop` is a PaczkoPunkt, otherwise a Paczkomat (both
 * carry the shared `parcel_locker` token, so it never discriminates). When
 * `type` is absent, falls back to a heuristic on the point `id`
 * (`POP-` prefix, case-insensitive) or display `name` (contains
 * "PaczkoPunkt"). Pure — no I/O.
 *
 * The Allegro order-source adapter (`AllegroOrderSourceAdapter.
 * classifyPickupPointType`) carries a deliberately-duplicated copy of the
 * fallback branch only (no ShipX `type` list at ingestion). Keep the two in
 * sync — a change to this heuristic should prompt an equivalent edit there.
 */
export function classifyInpostPointType(input: {
  id?: string;
  name?: string;
  type?: readonly string[];
}): PickupPointType {
  if (input.type && input.type.length > 0) {
    const tokens = input.type.map((t) => t.toLowerCase());
    return tokens.includes('pop') || tokens.includes('parcel_locker_superpop')
      ? PICKUP_POINT_TYPE.PartnerPoint
      : PICKUP_POINT_TYPE.Automat;
  }
  const idIsPop = (input.id ?? '').toLowerCase().startsWith('pop-');
  const nameIsPop = (input.name ?? '').toLowerCase().includes('paczkopunkt');
  return idIsPop || nameIsPop ? PICKUP_POINT_TYPE.PartnerPoint : PICKUP_POINT_TYPE.Automat;
}

/** Normalize the ShipX `type` (string | string[]) to a token array. */
function normalizePointTypeTokens(raw?: readonly string[] | string): readonly string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return typeof raw === 'string' ? [raw] : raw;
}

/** Build the `GET /v1/points` query string from the neutral finder query. */
export function buildPointsQuery(
  query: FindPickupPointsQuery,
): Record<string, string | number | undefined> {
  return {
    city: query.city,
    post_code: query.postalCode,
    name: query.searchText,
    per_page: query.limit,
  };
}

// --- internals ---------------------------------------------------------------

function buildLockerRequest(cmd: GenerateLabelCommand, sender: ShipXPeer): ShipXCreateShipmentRequest {
  if (!cmd.paczkomatId) {
    throw new ShippingProviderRejectionException(
      'inpost',
      'preflight.missing-paczkomat-id',
      'paczkomatId is required for a paczkomat shipment',
    );
  }
  if (!cmd.parcel.template) {
    throw new ShippingProviderRejectionException(
      'inpost',
      'preflight.missing-parcel-template',
      'parcel.template (locker size) is required for a paczkomat shipment',
    );
  }
  return {
    sender,
    receiver: toReceiverPeer(cmd, false),
    parcels: { template: cmd.parcel.template },
    service: 'inpost_locker_standard',
    reference: cmd.shipmentId,
    custom_attributes: { sending_method: 'dispatch_order', target_point: cmd.paczkomatId },
  };
}

function buildCourierRequest(cmd: GenerateLabelCommand, sender: ShipXPeer): ShipXCreateShipmentRequest {
  if (!cmd.recipient.address) {
    throw new ShippingProviderRejectionException(
      'inpost',
      'preflight.missing-recipient-address',
      'recipient.address is required for a courier shipment',
    );
  }
  const { dimensions, weightGrams } = cmd.parcel;
  if (!dimensions || weightGrams === undefined) {
    throw new ShippingProviderRejectionException(
      'inpost',
      'preflight.missing-dimensions-or-weight',
      'parcel.dimensions and parcel.weightGrams are required for a courier shipment',
    );
  }
  return {
    sender,
    receiver: toReceiverPeer(cmd, true),
    parcels: [
      {
        dimensions: {
          length: String(dimensions.length),
          width: String(dimensions.width),
          height: String(dimensions.height),
          unit: 'mm',
        },
        weight: { amount: (weightGrams / 1000).toFixed(2), unit: 'kg' },
        is_non_standard: false,
      },
    ],
    service: 'inpost_courier_standard',
    reference: cmd.shipmentId,
    custom_attributes: { sending_method: 'dispatch_order' },
  };
}

function toSenderPeer(sender: InpostSenderContact): ShipXPeer {
  return {
    company_name: sender.name,
    email: sender.email,
    phone: sender.phone,
    address: toShipXAddress(sender.address),
  };
}

function toReceiverPeer(cmd: GenerateLabelCommand, includeAddress: boolean): ShipXPeer {
  const recipient = cmd.recipient;
  const peer: ShipXPeer = {
    company_name: recipient.name,
    first_name: recipient.firstName,
    last_name: recipient.lastName,
    email: recipient.email,
    phone: recipient.phone,
  };
  if (includeAddress && recipient.address) {
    peer.address = toShipXAddress(recipient.address);
  }
  return peer;
}

function toShipXAddress(address: ShipmentAddress): ShipXAddress {
  return {
    street: address.street,
    building_number: address.buildingNumber,
    city: address.city,
    post_code: address.postCode,
    country_code: address.countryCode,
  };
}

function toPickupPointAddress(point: ShipXPoint): PickupPointAddress {
  return {
    line1: point.address?.line1 ?? point.address_details?.street ?? '',
    line2: point.address?.line2,
    city: point.address_details?.city ?? '',
    postalCode: point.address_details?.post_code ?? '',
    country: 'PL',
  };
}

function mapPickupPointStatus(raw?: string): PickupPointStatus {
  if (!raw) {
    return PICKUP_POINT_STATUS.Active;
  }
  const normalized = raw.toLowerCase();
  return normalized.includes('operating') && !normalized.includes('non')
    ? PICKUP_POINT_STATUS.Active
    : PICKUP_POINT_STATUS.TemporarilyUnavailable;
}
