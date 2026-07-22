/**
 * DPD Polska Shipment Mapper
 *
 * Pure translation between the carrier-neutral `@openlinker/core/shipping`
 * types and the DPDServices REST wire shapes. The single seam where DPD field
 * names, the COD `TransportService`, the field-flattening (split OL address →
 * single DPD `address` line; first/last → single `name`), and the grams→kg /
 * mm→cm unit conversions live — keeping the adapter free of wire-format detail.
 *
 * All functions are pure (no I/O, no logging). Command/response validation that
 * must surface to the operator throws `ShippingProviderRejectionException`
 * (same seam every shipping adapter uses, #885).
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/mappers
 */
import type {
  FindPickupPointsQuery,
  GenerateLabelCommand,
  GenerateLabelResult,
  LabelDocument,
  PickupPoint,
  PickupPointAddress,
  ShipmentAddress,
  ShipmentCod,
  ShipmentRecipient,
} from '@openlinker/core/shipping';
import { PICKUP_POINT_STATUS, ShippingProviderRejectionException } from '@openlinker/core/shipping';
import type { DpdConnectionConfig, DpdSenderContact } from '../../domain/types/dpd-config.types';
import type {
  DpdGeneratePackagesNumbersRequest,
  DpdGeneratePackagesNumbersResponse,
  DpdGenerateProtocolRequest,
  DpdGenerateProtocolResponse,
  DpdGenerateSpedLabelsRequest,
  DpdGenerateSpedLabelsResponse,
  DpdLabelSessionPackage,
  DpdParcel,
  DpdPoint,
  DpdPointSearchQuery,
  DpdPudoReceiver,
  DpdSenderOrReceiver,
  DpdSinglePackage,
  DpdTransportService,
  DpdValidationInfo,
} from '../../domain/types/dpd-rest.types';
import {
  DPD_COD_ATTRIBUTE,
  DPD_SERVICE_CODE_COD,
  DPD_SERVICE_CODE_DPD_PICKUP,
  DPD_STATUS_OK,
  DpdCodCurrencyValues,
} from '../../domain/types/dpd-rest.types';

const DPD_BRAND = 'dpd';

/**
 * DPD rejects a sender postal code that is syntactically `NN-NNN` but not a real
 * deliverable code for the configured sender city (e.g. `Warszawa` + `22-213`, a
 * Lublin-region code) as `INCORRECT_SENDER_POSTAL_CODE`. Unlike the receiver
 * postcode (which comes from the order), the sender postcode is stored on the
 * DPD connection config, so the remedy is an operator action on the connection.
 */
const DPD_SENDER_POSTAL_CODE_ERROR_CODE = 'INCORRECT_SENDER_POSTAL_CODE';
const DPD_SENDER_POSTAL_CODE_HINT =
  "The connection's sender postal code is not a deliverable DPD code for the sender city. " +
  'Correct the sender address on the DPD connection (the postal code must be a real code that ' +
  'matches the city, not merely the NN-NNN format).';

/**
 * Build the create-packages request for the command (v1: one package, one
 * parcel). Branches on shipping method: `kurier` → courier `receiver` (street
 * address); `pickup` → `pudoReceiver` + the `DPD_PICKUP` service (ship to a DPD
 * Pickup parcel-shop / PUDO point, #963). COD applies to either.
 */
export function buildCreatePackagesRequest(
  cmd: GenerateLabelCommand,
  config: DpdConnectionConfig,
): DpdGeneratePackagesNumbersRequest {
  if (cmd.shippingMethod !== 'kurier' && cmd.shippingMethod !== 'pickup') {
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      'preflight.unsupported-method',
      `DPD Polska supports 'kurier' and 'pickup' only; got '${String(cmd.shippingMethod)}'`,
    );
  }
  // Both methods carry a physical parcel → weight is always required.
  if (cmd.parcel.weightGrams === undefined) {
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      'preflight.missing-dimensions-or-weight',
      'parcel.weightGrams is required for a DPD shipment',
    );
  }

  const isPickup = cmd.shippingMethod === 'pickup';

  const services: DpdTransportService[] = [];
  if (isPickup) {
    services.push({ code: DPD_SERVICE_CODE_DPD_PICKUP });
  }
  if (cmd.cod) {
    services.push(buildCodService(cmd.cod));
  }

  const pkg: DpdSinglePackage = {
    reference: cmd.shipmentId,
    ref1: cmd.orderId,
    sender: toSenderPeer(config.senderAddress),
    payerFID: Number(config.payerFid),
    services: services.length > 0 ? services : undefined,
    parcels: [toParcel(cmd)],
  };

  if (isPickup) {
    pkg.pudoReceiver = toPudoReceiver(cmd);
  } else {
    if (!cmd.recipient.address) {
      throw new ShippingProviderRejectionException(
        DPD_BRAND,
        'preflight.missing-recipient-address',
        'recipient.address is required for a DPD courier shipment',
      );
    }
    pkg.receiver = toReceiverPeer(cmd.recipient, cmd.recipient.address);
  }

  return { generationPolicy: 'ALL_OR_NOTHING', packages: [pkg] };
}

/** Map a neutral pickup-point query to the DPD point-directory search shape. */
export function buildPointSearchQuery(query: FindPickupPointsQuery): DpdPointSearchQuery {
  return {
    city: query.city,
    postalCode: query.postalCode,
    searchText: query.searchText,
    limit: query.limit,
  };
}

/** Map a DPD Pickup point to the neutral `PickupPoint`. */
export function toPickupPoint(point: DpdPoint): PickupPoint {
  return {
    providerId: point.id,
    name: point.name ?? point.id,
    address: toPickupPointAddress(point),
    status: PICKUP_POINT_STATUS.Active,
    lat: point.latitude,
    lon: point.longitude,
  };
}

/**
 * Assert the create response succeeded at ALL three status levels (top, package,
 * parcel) — DPD returns business failures as HTTP 200 with a non-OK body status,
 * so a green HTTP call is not a green shipment. Returns the parcel waybill.
 */
export function assertCreateSucceededAndExtractWaybill(
  res: DpdGeneratePackagesNumbersResponse,
): string {
  const pkg = res.packages?.[0];
  const parcel = pkg?.parcels?.[0];
  // Collect every validation entry across both levels (parcel-first so the
  // primary discriminator/message keeps the existing precedence). DPD often
  // returns the real field-level reason at the PACKAGE level with an empty
  // parcel array (e.g. INCORRECT_*_POSTAL_CODE behind a top-level NOT_PROCESSED),
  // so both are surfaced into `providerDetails.validationInfo` (#1104).
  const allInfos: DpdValidationInfo[] = [
    ...(parcel?.validationInfo ?? []),
    ...(pkg?.validationInfo ?? []),
  ];

  if (res.status !== DPD_STATUS_OK) {
    throw reject(allInfos, `DPD create rejected (batch status: ${res.status})`);
  }
  if (!pkg || pkg.status !== DPD_STATUS_OK) {
    throw reject(allInfos, `DPD create rejected (package status: ${pkg?.status ?? 'missing'})`);
  }
  if (!parcel || parcel.status !== DPD_STATUS_OK) {
    throw reject(allInfos, `DPD create rejected (parcel status: ${parcel?.status ?? 'missing'})`);
  }
  if (!parcel.waybill) {
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      'command.success-without-shipment-id',
      'DPD reported OK but returned no waybill',
    );
  }
  return parcel.waybill;
}

/** Map an extracted waybill to the port result (waybill is the tracking number + label locator). */
export function toGenerateLabelResult(waybill: string): GenerateLabelResult {
  return { providerShipmentId: waybill, trackingNumber: waybill, labelPdfRef: waybill };
}

/** Build the label-render request for a single waybill (domestic PDF, A4, BIC3). */
export function buildGenerateLabelRequest(waybill: string): DpdGenerateSpedLabelsRequest {
  return {
    labelSearchParams: {
      policy: 'STOP_ON_FIRST_ERROR',
      session: {
        type: 'DOMESTIC',
        packages: [{ parcels: [{ waybill }] }],
      },
    },
    outputDocFormat: 'PDF',
    format: 'A4',
    outputType: 'BIC3',
  };
}

/** Assert the label response succeeded and decode the base64 PDF to bytes. */
export function decodeLabelDocument(res: DpdGenerateSpedLabelsResponse): LabelDocument {
  if (res.status !== DPD_STATUS_OK) {
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      res.status,
      `DPD label render rejected (status: ${res.status})`,
    );
  }
  if (!res.documentData) {
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      'command.empty-label',
      'DPD reported OK but returned no label document',
    );
  }
  return {
    contentType: 'application/pdf',
    body: new Uint8Array(Buffer.from(res.documentData, 'base64')),
  };
}

/**
 * Build the handover-protocol request over a batch of waybills (#964). One
 * domestic session listing every waybill as its own package/parcel, PDF output.
 */
export function buildGenerateProtocolRequest(waybills: string[]): DpdGenerateProtocolRequest {
  const packages: DpdLabelSessionPackage[] = waybills.map((waybill) => ({
    parcels: [{ waybill }],
  }));
  return {
    session: { type: 'DOMESTIC', packages },
    outputDocFormat: 'PDF',
  };
}

/** Assert the protocol response succeeded and decode the base64 PDF to bytes. */
export function decodeProtocolDocument(res: DpdGenerateProtocolResponse): LabelDocument {
  if (res.status !== DPD_STATUS_OK) {
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      res.status,
      `DPD protocol generation rejected (status: ${res.status})`,
    );
  }
  if (!res.documentData) {
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      'command.empty-protocol',
      'DPD reported OK but returned no protocol document',
    );
  }
  return {
    contentType: 'application/pdf',
    body: new Uint8Array(Buffer.from(res.documentData, 'base64')),
  };
}

// --- internals ---------------------------------------------------------------

function buildCodService(cod: ShipmentCod): DpdTransportService {
  if (!DpdCodCurrencyValues.includes(cod.currency as (typeof DpdCodCurrencyValues)[number])) {
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      'preflight.cod-currency-unsupported',
      `DPD COD currency must be one of ${DpdCodCurrencyValues.join(', ')}; got '${cod.currency}'`,
    );
  }
  return {
    code: DPD_SERVICE_CODE_COD,
    attributes: [
      { code: DPD_COD_ATTRIBUTE.Amount, value: cod.amount },
      { code: DPD_COD_ATTRIBUTE.Currency, value: cod.currency },
    ],
  };
}

function toParcel(cmd: GenerateLabelCommand): DpdParcel {
  const parcel: DpdParcel = {
    reference: cmd.shipmentId,
    // grams → kg (e.g. 1500 → 1.5).
    weight: (cmd.parcel.weightGrams as number) / 1000,
  };
  if (cmd.parcel.dimensions) {
    const { length, width, height } = cmd.parcel.dimensions;
    // OL dimensions are millimetres; DPD sizeX/Y/Z are centimetres.
    parcel.sizeX = length / 10;
    parcel.sizeY = width / 10;
    parcel.sizeZ = height / 10;
  }
  return parcel;
}

/**
 * Build the DPD Pickup `pudoReceiver` from the command — the point id (carried
 * on the generic `paczkomatId` field) + the buyer contact for pickup
 * notifications. No street address (the point's own address applies).
 */
function toPudoReceiver(cmd: GenerateLabelCommand): DpdPudoReceiver {
  if (!cmd.paczkomatId) {
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      'preflight.missing-paczkomat-id',
      'paczkomatId (the DPD Pickup point id) is required for a pickup shipment',
    );
  }
  return {
    pudoId: cmd.paczkomatId,
    name: resolveRecipientName(cmd.recipient),
    phone: cmd.recipient.phone,
    email: cmd.recipient.email,
  };
}

function toPickupPointAddress(point: DpdPoint): PickupPointAddress {
  return {
    line1: point.address?.street ?? '',
    city: point.address?.city ?? '',
    postalCode: point.address?.postalCode ?? '',
    country: point.address?.countryCode ?? 'PL',
  };
}

/**
 * DPD Polska's `postalCode` field expects bare digits (`NNNNN`), not the Polish
 * `NN-NNN` display form OpenLinker carries — sending the hyphenated form is
 * rejected as `INCORRECT_SENDER_POSTAL_CODE` / `INCORRECT_RECEIVER_POSTAL_CODE`
 * (surfaced opaquely as a top-level `NOT_PROCESSED` status). Strip every
 * non-digit; an already-bare code passes through unchanged. Confirmed against
 * the DPDServices demo (`01-612` rejected, `01612` accepted).
 */
function toDpdPostalCode(postalCode: string): string {
  return postalCode.replace(/\D/g, '');
}

function toSenderPeer(sender: DpdSenderContact): DpdSenderOrReceiver {
  return {
    company: sender.company,
    name: sender.name,
    address: sender.address,
    city: sender.city,
    countryCode: sender.countryCode,
    postalCode: toDpdPostalCode(sender.postalCode),
    phone: sender.phone,
    email: sender.email,
  };
}

function toReceiverPeer(recipient: ShipmentRecipient, address: ShipmentAddress): DpdSenderOrReceiver {
  // Recipient fields come from the order (not the DTO-validated sender config),
  // so DPD's length caps (name/address ≤100, city ≤50, postalCode ≤10) are NOT
  // pre-validated here — an over-cap or malformed value is rejected by DPD and
  // surfaced verbatim as a `ShippingProviderRejectionException`.
  return {
    // Omit `name` (optional on DPD) rather than send an empty string when the
    // order carries no name parts.
    name: resolveRecipientName(recipient),
    // OL splits street + buildingNumber; DPD's `address` is a single ≤100 line.
    address: `${address.street} ${address.buildingNumber}`.trim(),
    city: address.city,
    countryCode: address.countryCode,
    postalCode: toDpdPostalCode(address.postCode),
    phone: recipient.phone,
    email: recipient.email,
  };
}

function resolveRecipientName(recipient: ShipmentRecipient): string | undefined {
  if (recipient.name) {
    return recipient.name;
  }
  const composed = `${recipient.firstName ?? ''} ${recipient.lastName ?? ''}`.trim();
  return composed.length > 0 ? composed : undefined;
}

/**
 * Build the rejection from every collected validation entry. The first entry
 * (parcel-first precedence) drives the `providerCode` discriminator + message;
 * the full set is carried on `providerDetails.validationInfo` so a future
 * `NOT_PROCESSED` surfaces the field-level reason in structured logs / the API
 * response without a debug probe (#1104).
 *
 * When any collected entry is an `INCORRECT_SENDER_POSTAL_CODE`, the operator-
 * readable message is enriched with an actionable hint (#1778): the sender
 * postcode lives on the connection config, so the fix is an operator action —
 * a bare `NN-NNN` format is not enough, the code must actually be deliverable
 * for the configured city. The `providerCode` discriminator and structured
 * `providerDetails` are left untouched (parcel-first precedence preserved).
 */
function reject(allInfos: DpdValidationInfo[], fallback: string): ShippingProviderRejectionException {
  const first = allInfos[0];
  const baseMessage = first?.info ?? fallback;
  const hasSenderPostalCodeIssue = allInfos.some(
    (info) => info.errorCode === DPD_SENDER_POSTAL_CODE_ERROR_CODE,
  );
  const message = hasSenderPostalCodeIssue
    ? `${baseMessage}. ${DPD_SENDER_POSTAL_CODE_HINT}`
    : baseMessage;
  return new ShippingProviderRejectionException(
    DPD_BRAND,
    first?.errorCode ?? null,
    message,
    allInfos.length > 0
      ? { errorCode: first.errorCode, info: first.info, validationInfo: allInfos }
      : undefined,
  );
}
