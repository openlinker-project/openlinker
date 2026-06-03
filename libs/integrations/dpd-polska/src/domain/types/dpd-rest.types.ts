/**
 * DPD Polska `DPDServices` REST Wire Types
 *
 * Request/response shapes for the two endpoints this adapter uses, transcribed
 * from the live `DPDServices` OpenAPI (verified 2026-06-02):
 *   - `POST /public/shipment/v1/generatePackagesNumbers` (create → waybills)
 *   - `POST /public/shipment/v1/generateSpedLabels` (render → base64 PDF)
 *
 * Values WE emit (generation policy, service/attribute codes, label output
 * options, session type) are modelled as closed `as const` unions. Response
 * **status** fields are typed `string`, not unions: DPD's status enums are
 * open-ended and the adapter's correctness rule is "treat anything that is not
 * `'OK'` as a failure" — a `string` makes an unrecognised status fail safe
 * rather than mistype-pass.
 *
 * @module libs/integrations/dpd-polska/src/domain/types
 */

// --- shared value vocabularies (we emit these) -------------------------------

export const DpdGenerationPolicyValues = [
  'STOP_ON_FIRST_ERROR',
  'IGNORE_ERRORS',
  'ALL_OR_NOTHING',
] as const;
export type DpdGenerationPolicy = (typeof DpdGenerationPolicyValues)[number];

/** Status string that means success at every level of the body. */
export const DPD_STATUS_OK = 'OK';

/** ServiceCode values this adapter emits today (COD); the full enum is larger. */
export const DPD_SERVICE_CODE_COD = 'COD';

/** COD/declared-value attribute keys (generic `code`/`value` attribute bag). */
export const DPD_COD_ATTRIBUTE = {
  Amount: 'AMOUNT',
  Currency: 'CURRENCY',
} as const;

/** COD currencies DPD accepts. COD is mutually exclusive with INTERNATIONAL/PALETTE. */
export const DpdCodCurrencyValues = ['PLN', 'EUR', 'RON', 'CZK'] as const;
export type DpdCodCurrency = (typeof DpdCodCurrencyValues)[number];

// --- create: request ---------------------------------------------------------

export interface DpdAttribute {
  code: string;
  value: string;
}

export interface DpdTransportService {
  code: string;
  attributes?: DpdAttribute[];
}

export interface DpdSenderOrReceiver {
  company?: string;
  name?: string;
  address: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  postalCode: string;
  phone?: string;
  email?: string;
}

export interface DpdParcel {
  reference?: string;
  /** Kilograms. */
  weight: number;
  /** Centimetres. */
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  content?: string;
  customerData1?: string;
  customerData2?: string;
  customerData3?: string;
}

export interface DpdSinglePackage {
  reference?: string;
  sender: DpdSenderOrReceiver;
  receiver?: DpdSenderOrReceiver;
  /** Payer FID sub-number (numkat/fid). */
  payerFID: number;
  ref1?: string;
  ref2?: string;
  ref3?: string;
  services?: DpdTransportService[];
  parcels: DpdParcel[];
}

export interface DpdGeneratePackagesNumbersRequest {
  generationPolicy: DpdGenerationPolicy;
  packages: DpdSinglePackage[];
}

// --- create: response --------------------------------------------------------

export interface DpdValidationInfo {
  errorCode?: string;
  info?: string;
}

export interface DpdParcelResult {
  /** Non-`'OK'` ⇒ this parcel failed. */
  status: string;
  reference?: string;
  waybill?: string;
  validationInfo?: DpdValidationInfo[];
}

export interface DpdPackageResult {
  /** Non-`'OK'` ⇒ this package failed. */
  status: string;
  reference?: string;
  validationInfo?: DpdValidationInfo[];
  parcels?: DpdParcelResult[];
}

export interface DpdGeneratePackagesNumbersResponse {
  /** Top-level multi-package status; non-`'OK'` ⇒ the batch failed. */
  status: string;
  sessionId?: number;
  packages?: DpdPackageResult[];
  traceId?: string;
}

// --- label: request ----------------------------------------------------------

export const DpdLabelSessionTypeValues = ['DOMESTIC', 'INTERNATIONAL'] as const;
export type DpdLabelSessionType = (typeof DpdLabelSessionTypeValues)[number];

export const DpdLabelPolicyValues = ['STOP_ON_FIRST_ERROR', 'IGNORE_ERRORS'] as const;
export type DpdLabelPolicy = (typeof DpdLabelPolicyValues)[number];

export const DpdOutputDocFormatValues = ['PDF', 'EPL', 'ZPL', 'XML'] as const;
export type DpdOutputDocFormat = (typeof DpdOutputDocFormatValues)[number];

export const DpdLabelFormatValues = ['A4', 'LBL_PRINTER'] as const;
export type DpdLabelFormat = (typeof DpdLabelFormatValues)[number];

export const DpdLabelOutputTypeValues = ['BIC3', 'EXTENDED', 'RETURN'] as const;
export type DpdLabelOutputType = (typeof DpdLabelOutputTypeValues)[number];

export interface DpdLabelSessionParcel {
  reference?: string;
  waybill: string;
}

export interface DpdLabelSessionPackage {
  reference?: string;
  parcels: DpdLabelSessionParcel[];
}

export interface DpdLabelSession {
  type: DpdLabelSessionType;
  sessionId?: number;
  packages?: DpdLabelSessionPackage[];
}

export interface DpdLabelSearchParams {
  policy: DpdLabelPolicy;
  session: DpdLabelSession;
  documentId?: string;
}

export interface DpdGenerateSpedLabelsRequest {
  labelSearchParams: DpdLabelSearchParams;
  outputDocFormat: DpdOutputDocFormat;
  format: DpdLabelFormat;
  outputType: DpdLabelOutputType;
  variant?: string;
}

// --- label: response ---------------------------------------------------------

export interface DpdGenerateSpedLabelsResponse {
  /** Non-`'OK'` ⇒ label render failed. */
  status: string;
  /** Base64-encoded document bytes (PDF for `outputDocFormat: 'PDF'`). */
  documentData?: string;
  documentId?: string;
  traceId?: string;
}

// --- error envelopes ---------------------------------------------------------

export interface DpdErrorItem {
  code?: string;
  subCode?: string;
  userMessage?: string;
  rejectedValue?: string;
  field?: string;
}

/** `400`-style body. */
export interface DpdErrors {
  errors?: DpdErrorItem[];
  traceId?: string;
}

/** `401` body. */
export interface DpdError401 {
  status?: string;
}
