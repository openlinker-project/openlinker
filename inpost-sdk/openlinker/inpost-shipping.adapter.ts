/**
 * InPost Shipping Adapter (prototype) — mirror of the real
 * `libs/integrations/inpost/.../inpost-shipping.adapter.ts`.
 *
 * Implements OpenLinker's `ShippingProviderManagerPort` + the `ShipmentCanceller`,
 * `PickupPointFinder` and `LabelDocumentReader` sub-capabilities, but on top of
 * the standalone `InpostShipXClient` instead of the monorepo's HTTP client.
 * The wire translation (status table, locker-vs-courier request builders) is
 * copied from the real `inpost-shipx.mapper.ts` so behaviour matches.
 *
 * **One deliberate difference from the real adapter:** the real `generateLabel`
 * just POSTs the create request and returns — it assumes a production contract
 * account that auto-confirms server-side. The InPost *sandbox* account does NOT
 * auto-confirm: a created shipment sits at `offers_prepared` → `offer_selected`
 * and must be explicitly bought. So this prototype's `generateLabel` runs the
 * offer→buy→confirm dance when `autoConfirm` is set (default true), which is
 * what makes the end-to-end sandbox flow reach a printable label.
 */

import { InpostShipXClient } from '../src/application/inpost-shipx.client.ts';
import { InpostApiError } from '../src/domain/errors/inpost-api.error.ts';
import type { CreateShipmentCommand, Shipment } from '../src/domain/types/shipment.types.ts';
import { ShippingProviderRejectionException } from './shipping-provider-rejection.ts';
import type {
  FindPickupPointsQuery,
  GenerateLabelCommand,
  GenerateLabelResult,
  InpostConnectionConfig,
  LabelDocument,
  PickupPoint,
  PickupPointStatus,
  ShipmentStatus,
  ShippingMethod,
  TrackingSnapshot,
} from './ol-shipping.types.ts';
import { PICKUP_POINT_STATUS } from './ol-shipping.types.ts';

const SUPPORTED_METHODS: readonly ShippingMethod[] = ['paczkomat', 'kurier'];

/** Full ShipX status → OL bucket. Copied verbatim from the real mapper. */
const SHIPX_STATUS_TO_OL: Readonly<Record<string, ShipmentStatus>> = {
  created: 'generated',
  offers_prepared: 'generated',
  offer_selected: 'generated',
  confirmed: 'generated',
  dispatched_by_sender: 'dispatched',
  dispatched_by_sender_to_pok: 'dispatched',
  collected_from_sender: 'dispatched',
  taken_by_courier: 'dispatched',
  taken_by_courier_from_pok: 'dispatched',
  adopted_at_source_branch: 'dispatched',
  sent_from_source_branch: 'dispatched',
  adopted_at_sorting_center: 'dispatched',
  taken_by_courier_from_customer_service_point: 'dispatched',
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
  delivered: 'delivered',
  canceled: 'cancelled',
  canceled_redirect_to_box: 'cancelled',
  returned_to_sender: 'failed',
  rejected_by_receiver: 'failed',
  undelivered: 'failed',
  undelivered_wrong_address: 'failed',
  undelivered_cod_cash_receiver: 'failed',
  pickup_time_expired: 'failed',
  stack_parcel_pickup_time_expired: 'failed',
  stack_parcel_in_box_machine_pickup_time_expired: 'failed',
};

export function mapShipXStatus(raw: string): ShipmentStatus | null {
  return SHIPX_STATUS_TO_OL[raw] ?? null;
}

/**
 * How a parcel enters the InPost network — orthogonal to the delivery method
 * (paczkomat/kurier). Maps to ShipX `custom_attributes.sending_method`:
 *  - `courier_collect` → `dispatch_order` (InPost courier picks up from sender)
 *  - `drop_at_locker`  → `parcel_locker`  (sender drops at a paczkomat; needs a
 *                         `dropoffPoint` distinct from the destination locker)
 *  - `drop_at_point`   → `pop`            (sender drops at a PUDO point)
 */
export type InpostSendingMethod = 'courier_collect' | 'drop_at_locker' | 'drop_at_point';

const SENDING_METHOD_TO_SHIPX: Readonly<Record<InpostSendingMethod, string>> = {
  courier_collect: 'dispatch_order',
  drop_at_locker: 'parcel_locker',
  drop_at_point: 'pop',
};

/** Per-dispatch shipping options (the operator's "how do I send this?" choice). */
export interface DispatchOptions {
  readonly sendingMethod?: InpostSendingMethod;
  /** Source locker code — required when `sendingMethod === 'drop_at_locker'`. */
  readonly dropoffPoint?: string;
}

export interface InpostShippingAdapterOptions {
  /** Run the sandbox offer→buy→confirm dance inside generateLabel. Default true. */
  readonly autoConfirm?: boolean;
  readonly confirmTimeoutMs?: number;
  /** Sending method used when a dispatch doesn't specify one. Default `courier_collect`. */
  readonly defaultSendingMethod?: InpostSendingMethod;
}

export class InpostShippingAdapter {
  readonly #client: InpostShipXClient;
  readonly #config: InpostConnectionConfig;
  readonly #autoConfirm: boolean;
  readonly #confirmTimeoutMs: number;
  readonly #defaultSendingMethod: InpostSendingMethod;

  constructor(
    client: InpostShipXClient,
    config: InpostConnectionConfig,
    options?: InpostShippingAdapterOptions,
  ) {
    this.#client = client;
    this.#config = config;
    this.#autoConfirm = options?.autoConfirm ?? true;
    this.#confirmTimeoutMs = options?.confirmTimeoutMs ?? 60_000;
    this.#defaultSendingMethod = options?.defaultSendingMethod ?? 'courier_collect';
  }

  getSupportedMethods(): readonly ShippingMethod[] {
    return SUPPORTED_METHODS;
  }

  async generateLabel(
    cmd: GenerateLabelCommand,
    dispatch?: DispatchOptions,
  ): Promise<GenerateLabelResult> {
    const body = this.#buildCreateShipmentRequest(cmd, dispatch);

    let shipment: Shipment;
    try {
      shipment = await this.#client.createShipment(body, this.#config.organizationId);
    } catch (error) {
      throw this.#tagTargetPoint(error, cmd);
    }

    if (this.#autoConfirm && mapShipXStatus(shipment.status) === 'generated' && shipment.status !== 'confirmed') {
      shipment = await this.#confirm(shipment);
    }

    return {
      providerShipmentId: String(shipment.id),
      trackingNumber: shipment.tracking_number,
      labelPdfRef: `shipx:label:${shipment.id}`,
    };
  }

  async getTracking(input: { providerShipmentId: string }): Promise<TrackingSnapshot> {
    const shipment = await this.#client.getShipment(input.providerShipmentId);
    const mapped = mapShipXStatus(shipment.status) ?? 'in-transit';
    return { status: mapped, providerStatus: shipment.status, carrier: 'inpost' };
  }

  async cancelShipment(input: { providerShipmentId: string }): Promise<void> {
    await this.#client.cancelShipment(input.providerShipmentId);
  }

  async findPickupPoints(query: FindPickupPointsQuery): Promise<PickupPoint[]> {
    const response = await this.#client.getPoints({
      city: query.city,
      relative_post_code: query.postalCode,
      per_page: query.limit ?? 10,
      type: 'parcel_locker',
    });
    return response.items.map((point) => ({
      providerId: point.name,
      name: point.name,
      address: {
        line1: point.address?.line1 ?? point.address_details?.street ?? '',
        line2: point.address?.line2 ?? undefined,
        city: point.address_details?.city ?? '',
        postalCode: point.address_details?.post_code ?? '',
        country: 'PL',
      },
      status: mapPickupPointStatus(point.status),
      lat: point.location?.latitude,
      lon: point.location?.longitude,
    }));
  }

  async fetchLabel(input: { providerShipmentId: string }): Promise<LabelDocument> {
    const { body, contentType } = await this.#client.getLabelDocument(input.providerShipmentId, {
      format: 'pdf',
    });
    return { contentType: contentType || 'application/pdf', body };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  #buildCreateShipmentRequest(
    cmd: GenerateLabelCommand,
    dispatch?: DispatchOptions,
  ): CreateShipmentCommand {
    if (!SUPPORTED_METHODS.includes(cmd.shippingMethod)) {
      throw new ShippingProviderRejectionException(
        'inpost',
        'preflight.unsupported-method',
        `Unsupported shipping method: ${String(cmd.shippingMethod)}`,
      );
    }
    const sender = {
      company_name: this.#config.senderAddress.name,
      email: this.#config.senderAddress.email,
      phone: this.#config.senderAddress.phone,
      address: toShipXAddress(this.#config.senderAddress.address),
    };

    if (cmd.shippingMethod === 'paczkomat') {
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
        receiver: {
          company_name: cmd.recipient.name,
          first_name: cmd.recipient.firstName,
          last_name: cmd.recipient.lastName,
          email: cmd.recipient.email,
          phone: cmd.recipient.phone,
        },
        parcels: [{ template: cmd.parcel.template }],
        service: 'inpost_locker_standard',
        reference: cmd.shipmentId,
        custom_attributes: this.#buildSendingAttributes(dispatch, cmd.paczkomatId),
      };
    }

    // kurier
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
      receiver: {
        company_name: cmd.recipient.name,
        first_name: cmd.recipient.firstName,
        last_name: cmd.recipient.lastName,
        email: cmd.recipient.email,
        phone: cmd.recipient.phone,
        address: toShipXAddress(cmd.recipient.address),
      },
      parcels: [
        {
          dimensions: { length: dimensions.length, width: dimensions.width, height: dimensions.height, unit: 'mm' },
          weight: { amount: weightGrams / 1000, unit: 'kg' },
          is_non_standard: false,
        },
      ],
      service: this.#config.courierService ?? 'inpost_courier_standard',
      reference: cmd.shipmentId,
      custom_attributes: this.#buildSendingAttributes(dispatch),
    };
  }

  /**
   * Builds the sending half of `custom_attributes` from the dispatch options
   * (defaulting to the adapter's configured sending method), plus `target_point`
   * for locker deliveries. Validates the `drop_at_locker` invariants live ShipX
   * enforces (dropoff required, and distinct from the destination locker).
   */
  #buildSendingAttributes(
    dispatch: DispatchOptions | undefined,
    targetPoint?: string,
  ): Record<string, string> {
    const method = dispatch?.sendingMethod ?? this.#defaultSendingMethod;
    const attributes: Record<string, string> = { sending_method: SENDING_METHOD_TO_SHIPX[method] };
    if (targetPoint) attributes.target_point = targetPoint;

    if (method === 'drop_at_locker') {
      if (!dispatch?.dropoffPoint) {
        throw new ShippingProviderRejectionException(
          'inpost',
          'preflight.missing-dropoff-point',
          'dropoffPoint is required when sendingMethod is drop_at_locker',
        );
      }
      if (targetPoint && dispatch.dropoffPoint === targetPoint) {
        throw new ShippingProviderRejectionException(
          'inpost',
          'preflight.dropoff-equals-target',
          'dropoffPoint must differ from the destination locker (target_point)',
        );
      }
      attributes.dropoff_point = dispatch.dropoffPoint;
    }
    return attributes;
  }

  /**
   * Sandbox-only: wait for the auto-selected offer, buy it, wait for
   * confirmation. Idempotent — a funded sandbox account may auto-buy the offer
   * before our explicit `buy` lands (race → `already_bought`), which we treat
   * as success and just wait out the confirmation.
   */
  async #confirm(created: Shipment): Promise<Shipment> {
    const isConfirmed = (status: string): boolean =>
      status === 'confirmed' || status === 'dispatched_by_sender';

    // Wait until ShipX has selected an offer (or already confirmed it).
    const withOffer = await this.#client.waitForShipmentStatus(
      created.id,
      (status, s) =>
        isConfirmed(status) ||
        status === 'offer_selected' ||
        !!s.selected_offer ||
        (s.offers?.some((o) => o.status === 'selected') ?? false),
      { timeoutMs: 30_000, intervalMs: 2_000 },
    );
    if (isConfirmed(withOffer.status)) return withOffer;

    const offer =
      withOffer.selected_offer ??
      withOffer.offers?.find((o) => o.status === 'selected') ??
      withOffer.offers?.find((o) => o.status === 'available') ??
      withOffer.offers?.[0];
    if (!offer) {
      throw new ShippingProviderRejectionException(
        'inpost',
        'command.success-without-shipment-id',
        `Shipment ${created.id} produced no purchasable offer`,
      );
    }

    try {
      await this.#client.buyShipment(created.id, offer.id);
    } catch (error) {
      if (!isAlreadyBought(error)) throw error;
      // Auto-bought by ShipX before our call — fine, fall through to wait.
    }

    return this.#client.waitForShipmentStatus(
      created.id,
      (status, s) => {
        const failed = s.transactions?.find((t) => t.status === 'failure');
        if (failed) {
          throw new ShippingProviderRejectionException(
            'inpost',
            `api.${failed.details?.error ?? 'buy-failed'}`,
            `Buy failed for shipment ${created.id}: ${failed.details?.error ?? 'unknown'} — check sandbox balance`,
            { offerId: offer.id, ...(failed.details ?? {}) },
          );
        }
        return isConfirmed(status);
      },
      { timeoutMs: this.#confirmTimeoutMs, intervalMs: 3_000 },
    );
  }

  #tagTargetPoint(error: unknown, cmd: GenerateLabelCommand): unknown {
    if (error instanceof InpostApiError && cmd.paczkomatId && /target_point|paczkomat/i.test(error.message)) {
      return new ShippingProviderRejectionException('inpost', 'target_point', error.message, {
        paczkomatId: cmd.paczkomatId,
      });
    }
    return error;
  }
}

/** A ShipX `buy` rejection meaning the offer was already purchased (race-safe). */
function isAlreadyBought(error: unknown): boolean {
  if (!(error instanceof InpostApiError) || error.status !== 400) return false;
  const details = error.details;
  if (details && typeof details === 'object' && 'shipment' in details) {
    const reasons = (details as { shipment?: unknown }).shipment;
    if (Array.isArray(reasons) && reasons.includes('already_bought')) return true;
  }
  return /already_bought/.test(error.message);
}

function toShipXAddress(address: {
  street: string;
  buildingNumber: string;
  city: string;
  postCode: string;
  countryCode: string;
}) {
  return {
    street: address.street,
    building_number: address.buildingNumber,
    city: address.city,
    post_code: address.postCode,
    country_code: address.countryCode,
  };
}

function mapPickupPointStatus(raw?: string): PickupPointStatus {
  if (!raw) return PICKUP_POINT_STATUS.Active;
  const normalized = raw.toLowerCase();
  return normalized.includes('operating') && !normalized.includes('non')
    ? PICKUP_POINT_STATUS.Active
    : PICKUP_POINT_STATUS.TemporarilyUnavailable;
}
