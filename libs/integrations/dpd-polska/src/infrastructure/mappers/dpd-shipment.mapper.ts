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
  GenerateLabelCommand,
  GenerateLabelResult,
  LabelDocument,
  ShipmentAddress,
  ShipmentCod,
  ShipmentRecipient,
} from '@openlinker/core/shipping';
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';
import type { DpdConnectionConfig, DpdSenderContact } from '../../domain/types/dpd-config.types';
import type {
  DpdGeneratePackagesNumbersRequest,
  DpdGeneratePackagesNumbersResponse,
  DpdGenerateSpedLabelsRequest,
  DpdGenerateSpedLabelsResponse,
  DpdParcel,
  DpdSenderOrReceiver,
  DpdTransportService,
  DpdValidationInfo,
} from '../../domain/types/dpd-rest.types';
import {
  DPD_COD_ATTRIBUTE,
  DPD_SERVICE_CODE_COD,
  DPD_STATUS_OK,
  DpdCodCurrencyValues,
} from '../../domain/types/dpd-rest.types';

const DPD_BRAND = 'dpd';

/** Build the create-packages request for the command (v1: one package, one parcel). */
export function buildCreatePackagesRequest(
  cmd: GenerateLabelCommand,
  config: DpdConnectionConfig,
): DpdGeneratePackagesNumbersRequest {
  if (cmd.shippingMethod !== 'kurier') {
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      'preflight.unsupported-method',
      `DPD Polska supports 'kurier' only; got '${String(cmd.shippingMethod)}'`,
    );
  }
  if (!cmd.recipient.address) {
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      'preflight.missing-recipient-address',
      'recipient.address is required for a DPD courier shipment',
    );
  }
  if (cmd.parcel.weightGrams === undefined) {
    throw new ShippingProviderRejectionException(
      DPD_BRAND,
      'preflight.missing-dimensions-or-weight',
      'parcel.weightGrams is required for a DPD courier shipment',
    );
  }

  const services = cmd.cod ? [buildCodService(cmd.cod)] : undefined;

  return {
    generationPolicy: 'ALL_OR_NOTHING',
    packages: [
      {
        reference: cmd.shipmentId,
        ref1: cmd.orderId,
        sender: toSenderPeer(config.senderAddress),
        receiver: toReceiverPeer(cmd.recipient, cmd.recipient.address),
        payerFID: Number(config.payerFid),
        services,
        parcels: [toParcel(cmd)],
      },
    ],
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
  const info = firstValidation(parcel?.validationInfo) ?? firstValidation(pkg?.validationInfo);

  if (res.status !== DPD_STATUS_OK) {
    throw reject(info, `DPD create rejected (batch status: ${res.status})`);
  }
  if (!pkg || pkg.status !== DPD_STATUS_OK) {
    throw reject(info, `DPD create rejected (package status: ${pkg?.status ?? 'missing'})`);
  }
  if (!parcel || parcel.status !== DPD_STATUS_OK) {
    throw reject(info, `DPD create rejected (parcel status: ${parcel?.status ?? 'missing'})`);
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

function toSenderPeer(sender: DpdSenderContact): DpdSenderOrReceiver {
  return {
    company: sender.company,
    name: sender.name,
    address: sender.address,
    city: sender.city,
    countryCode: sender.countryCode,
    postalCode: sender.postalCode,
    phone: sender.phone,
    email: sender.email,
  };
}

function toReceiverPeer(recipient: ShipmentRecipient, address: ShipmentAddress): DpdSenderOrReceiver {
  return {
    name: resolveRecipientName(recipient),
    // OL splits street + buildingNumber; DPD's `address` is a single ≤100 line.
    address: `${address.street} ${address.buildingNumber}`.trim(),
    city: address.city,
    countryCode: address.countryCode,
    postalCode: address.postCode,
    phone: recipient.phone,
    email: recipient.email,
  };
}

function resolveRecipientName(recipient: ShipmentRecipient): string {
  return recipient.name ?? `${recipient.firstName ?? ''} ${recipient.lastName ?? ''}`.trim();
}

function firstValidation(infos?: DpdValidationInfo[]): DpdValidationInfo | undefined {
  return infos && infos.length > 0 ? infos[0] : undefined;
}

function reject(info: DpdValidationInfo | undefined, fallback: string): ShippingProviderRejectionException {
  return new ShippingProviderRejectionException(
    DPD_BRAND,
    info?.errorCode ?? null,
    info?.info ?? fallback,
    info ? { errorCode: info.errorCode, info: info.info } : undefined,
  );
}
