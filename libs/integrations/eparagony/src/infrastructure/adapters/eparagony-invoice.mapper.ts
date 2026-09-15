/**
 * eparagony.pl Invoice Mapper
 *
 * Pure translation between the neutral invoicing vocabulary and the vendor's
 * `eInvoice` wire shapes. The sibling of `eparagony-document.mapper.ts`, and
 * deliberately a SEPARATE file: the two document kinds share an endpoint and a
 * status read, and share no field, no rate vocabulary and no arithmetic.
 *
 * Two directions:
 *   - {@link toCreateInvoiceRequest} - neutral command -> `POST /documents` body.
 *   - {@link toRegulatoryClearanceResult} - document status -> neutral clearance.
 *
 * THE ARITHMETIC IS THE HARD PART, so it is stated here once.
 *
 * OpenLinker holds the buyer-paid GROSS per line (ADR-014: the source's price is
 * authoritative). The vendor's invoice is NET-shaped, and requires a per-rate net
 * and tax summary whichever summary method is declared. So net has to be derived,
 * and the only question is where the rounding lands.
 *
 * It lands PER RATE GROUP, never per line:
 *
 *   grossGroup = sum of the group's line gross amounts   (exact, no rounding)
 *   taxGroup   = round(grossGroup x r / (1 + r))         (one rounding per group)
 *   netGroup   = grossGroup - taxGroup                   (exact by subtraction)
 *
 * so `netGroup + taxGroup === grossGroup` holds to the grosz by construction, and
 * the sum of the groups is the gross the buyer actually paid. The per-line net
 * values the wire also wants are then ALLOCATED inside the group - each line
 * rounds independently except the last, which absorbs the residual - so the lines
 * sum back to the group exactly too. Rounding each line independently and adding
 * them up is the shape that produces a document whose summary disagrees with its
 * own lines by a grosz, which is the defect ADR-063 records against FA(3) and
 * names an adapter bug.
 *
 * EVERY UNMAPPABLE INPUT THROWS BEFORE ANYTHING IS SENT, as
 * {@link EparagonyConfigException} (`failureMode: 'rejected'`, nothing crossed the
 * boundary). What it does NOT do is pre-judge a value the vendor is the judge of:
 * the buyer's tax number, name and postcode all travel verbatim and their refusal
 * arrives as an ordinary `EparagonyApiError` (ADR-073 decision 5).
 *
 * No I/O, no framework, no logger.
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters
 */
import type {
  BuyerAddress,
  InvoiceLine,
  IssueInvoiceCommand,
  IssuedDocumentSeller,
  RegulatoryClearanceResult,
} from '@openlinker/core/invoicing';

import { EparagonyConfigException } from '../../domain/exceptions/eparagony-config.exception';
import { toMinorUnits, toQuantityString } from '../../domain/policies/money.policy';
import {
  invoiceTaxRateFraction,
  isTaxedInvoiceRate,
  resolveInvoiceTaxRateCode,
} from '../../domain/policies/invoice-tax-rate.policy';
import {
  EPARAGONY_CALCULATION_VALIDATION_NONE,
  EPARAGONY_EINVOICING_HUB_KSEF,
  EPARAGONY_INVOICE_TYPE_VAT,
  EPARAGONY_PROCESSING_MODE_KSEF,
  EPARAGONY_PROCESSING_MODE_NONE,
  EPARAGONY_STATUS_CONFIRMED,
  EPARAGONY_STATUS_ERROR,
  EPARAGONY_VAT_CALCULATION_SUM_OF_RATES_NET,
  type EparagonyCreateInvoiceRequest,
  type EparagonyDocumentStatusResponse,
  type EparagonyEntityAddress,
  type EparagonyInvoiceBody,
  type EparagonyInvoiceLine,
  type EparagonyInvoiceMetadata,
  type EparagonyInvoiceTaxRate,
  type EparagonyKsefInvoiceDetails,
  type EparagonyTaxedInvoiceRate,
} from '../../domain/types/eparagony-api.types';
import type {
  EparagonyConnectionConfig,
  EparagonySellerAddress,
} from '../../domain/types/eparagony-config.types';

/**
 * The only settlement currency this adapter issues in.
 *
 * A foreign-currency invoice additionally requires an `exchangeRate`, and there
 * is no honest source for one: ADR-040 states in terms that OpenLinker's own FX
 * stamp is ANALYTICS-ONLY and must never supply a fiscal document's rate (it
 * anchors on a different date, converts to a different target, and may be an
 * inverted or pivoted cross rather than a directly published quote). Refusing is
 * the only alternative to inventing one.
 */
const SETTLEMENT_CURRENCY = 'PLN';

/**
 * The regime's own zone, used to render an issuance instant as the calendar date
 * the document carries. A UTC `YYYY-MM-DD` would be a day early for anything
 * issued after 22:00 local in winter, which on a fiscal document is a real
 * error and not a display detail.
 */
const REGIME_TIME_ZONE = 'Europe/Warsaw';

/** Calendar-date shape the vendor takes for `invoiceDate` / `saleEndDate`. */
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A street line that ends in a building number: everything up to the last
 * whitespace/comma-separated token that STARTS with a digit. Matches
 * `ul. Grzybowska 2`, `Marszalkowska 12/34` and `Dluga 7a`.
 */
const STREET_AND_NUMBER_PATTERN = /^(.*?)[\s,]+([0-9][0-9A-Za-z./\\-]*)$/;

/**
 * What `number` carries when the buyer's address line names no building number.
 *
 * The field is required and must be non-empty, and refusing here would be a
 * permanent domain rejection of a real, paid order over a formatting detail -
 * the failure shape ANALYSIS-1032 names a defect. Nothing is LOST either way:
 * on this branch the whole address line survives in `street`.
 */
const UNKNOWN_BUILDING_NUMBER = '-';

export interface CreateInvoiceRequestInput {
  command: IssueInvoiceCommand;
  config: EparagonyConnectionConfig;
  documentToken: string;
  transactionToken: string;
}

/** One line priced in minor units and resolved onto a vendor rate code. */
interface PricedInvoiceLine {
  line: InvoiceLine;
  code: EparagonyInvoiceTaxRate;
  quantity: string;
  grossMinor: number;
}

/**
 * Compose the `POST /documents` body for a VAT invoice.
 *
 * @throws {EparagonyConfigException} when the sale cannot be expressed as an
 * invoice at all: a currency that would need an exchange rate, a connection with
 * no seller tax number, an unresolvable rate, or a non-registrable amount.
 */
export function toCreateInvoiceRequest(
  input: CreateInvoiceRequestInput,
): EparagonyCreateInvoiceRequest {
  const { command, config, documentToken, transactionToken } = input;

  const currency = command.currency.trim().toUpperCase();
  if (currency !== SETTLEMENT_CURRENCY) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot invoice order ${command.orderId}: currency ${currency} would require ` +
        `an exchange rate this adapter has no authoritative source for`,
      // "unsupported currency" is one of core's CURRENCY_REJECTION_MARKERS, so
      // this refusal reaches the operator as `invalid-currency` rather than as
      // the generic provider-rejected copy.
      `Unsupported currency for this invoicing connection: it issues in ${SETTLEMENT_CURRENCY} only.`,
    );
  }

  const merchantTIN = readNonEmpty(config.merchantTIN);
  if (merchantTIN === null) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot invoice order ${command.orderId}: the connection declares no seller ` +
        `tax number, which is mandatory on every invoice`,
      "This connection has no seller tax number set, which every invoice requires. Set it on the connection and re-issue.",
    );
  }

  if (command.lines.length === 0) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot invoice order ${command.orderId}: it has no lines`,
      'The order has no lines, so there is nothing to invoice.',
    );
  }

  const priced = command.lines.map((line) => toPricedLine(line, command.orderId));
  const groups = groupByRate(priced);

  const lines: EparagonyInvoiceLine[] = [];
  const netValueByTaxRate: Partial<Record<EparagonyInvoiceTaxRate, number>> = {};
  const taxValueByTaxRate: Partial<Record<EparagonyTaxedInvoiceRate, number>> = {};
  let grossSaleValue = 0;

  for (const [code, members] of groups) {
    const fraction = invoiceTaxRateFraction(code);
    const grossGroup = members.reduce((sum, member) => sum + member.grossMinor, 0);
    // ONE rounding per group; net follows by subtraction so the two always add
    // back up to the gross the buyer paid.
    const taxGroup = fraction === 0 ? 0 : roundMinorUnits((grossGroup * fraction) / (1 + fraction));
    const netGroup = grossGroup - taxGroup;

    grossSaleValue += grossGroup;
    netValueByTaxRate[code] = netGroup;
    if (isTaxedInvoiceRate(code)) {
      taxValueByTaxRate[code] = taxGroup;
    }

    let allocatedNet = 0;
    members.forEach((member, index) => {
      const isLast = index === members.length - 1;
      // The last line absorbs the residual, so the group's lines sum back to the
      // group's own summary exactly rather than to within a grosz of it.
      const lineNet = isLast
        ? netGroup - allocatedNet
        : roundMinorUnits(member.grossMinor / (1 + fraction));
      allocatedNet += lineNet;

      lines.push({
        productOrServiceName: member.line.name,
        quantity: member.quantity,
        netUnitPrice: resolveNetUnitPrice(lineNet, member.line.quantity),
        netTotalLineValue: lineNet,
        taxRate: code,
        // Required on every line, including a zero-rated one, where it is 0.
        taxValue: member.grossMinor - lineNet,
      });
    });
  }

  const metadata: EparagonyInvoiceMetadata = {
    vatCalculationMethod: EPARAGONY_VAT_CALCULATION_SUM_OF_RATES_NET,
    calculationValidation: EPARAGONY_CALCULATION_VALIDATION_NONE,
    grossSaleValue,
    merchantTIN,
    consumerName: command.buyer.name,
    consumerAddress: toEntityAddress(command.buyer.address),
    netValueByTaxRate,
    taxValueByTaxRate,
    // Stamped explicitly rather than left to the vendor's account default - the
    // #2103 lesson: an omitted currency books the document in whatever the
    // account is configured for, silently and with no error.
    currency: SETTLEMENT_CURRENCY,
    // Carried so a support conversation can tie the document back to the order.
    orderId: command.orderId,
  };

  // Sent verbatim, never validated or reformatted (ADR-073 decision 5): an
  // absent `scheme` means "untagged, decide for your own market", never "not a
  // tax id", so the value travels whatever tag it does or does not carry.
  // Absent means the buyer has NO tax number, which the vendor reads as B2C - so
  // the key must then be absent too, rather than empty or null.
  const consumerTIN = readNonEmpty(command.buyer.taxId?.value);
  if (consumerTIN !== null) {
    metadata.consumerTIN = consumerTIN;
  }

  const merchantName = readNonEmpty(config.merchantName);
  if (merchantName !== null) {
    metadata.merchantName = merchantName;
  }
  if (config.merchantAddress !== undefined) {
    metadata.merchantAddress = toSellerEntityAddress(config.merchantAddress);
  }

  // Present only when OpenLinker allocated the number. This adapter is not a
  // `DocumentNumberConsumer`, so core does not set it today and the vendor
  // generates the legal number itself - the field is honoured so that turning
  // numbering on later needs no change here.
  const documentNumber = readNonEmpty(command.documentNumber);
  if (documentNumber !== null) {
    metadata.invoiceNumber = documentNumber;
  }

  const invoiceDate = toRegimeCalendarDate(command.issuedAt);
  if (invoiceDate !== null) {
    metadata.invoiceDate = invoiceDate;
  }
  // Already a calendar date on the neutral command; shape-checked, never reformatted.
  if (typeof command.saleDate === 'string' && CALENDAR_DATE_PATTERN.test(command.saleDate)) {
    metadata.saleEndDate = command.saleDate;
  }

  const eInvoice: EparagonyInvoiceBody = {
    invoiceType: EPARAGONY_INVOICE_TYPE_VAT,
    metadata,
    lines,
  };
  if (config.eInvoicingHubEnabled === true) {
    // On the `eInvoice` object ITSELF, not inside `extensions` - a natural place
    // to look for it, and the wrong one.
    eInvoice.eInvoicingHub = EPARAGONY_EINVOICING_HUB_KSEF;
  }

  return { posId: config.posId, documentToken, transactionToken, eInvoice };
}

/**
 * The seller block as the neutral result reports it, or `null` when the
 * connection configures no seller party.
 *
 * Reported only when BOTH a name and an address are configured: the neutral
 * {@link IssuedDocumentSeller} requires both, and half a seller is worse than
 * none - it would render on the issued-document card as a party with a blank
 * address the operator has no way to read as "not configured".
 */
export function toIssuedDocumentSeller(
  config: EparagonyConnectionConfig,
): IssuedDocumentSeller | null {
  const name = readNonEmpty(config.merchantName);
  const taxId = readNonEmpty(config.merchantTIN);
  const address = config.merchantAddress;
  if (name === null || taxId === null || address === undefined) {
    return null;
  }
  return {
    name,
    // The adapter supplies the scheme tag, exactly as ADR-073 decision 1 says it
    // must - core holds a bare number and may not mint one.
    taxId: { scheme: 'pl-nip', value: taxId },
    address: {
      line1: `${address.street} ${address.number}`.trim(),
      line2: readNonEmpty(address.apartment),
      city: address.city,
      postalCode: address.postalCode,
      countryIso2: address.country,
    },
  };
}

/**
 * Domestic tax number in this regime: exactly ten digits. Used ONLY to pick a
 * scheme tag for a customer handle - never to validate a value on its way to a
 * document, which ADR-073 decision 5 reserves to the provider.
 */
const DOMESTIC_TAX_ID_PATTERN = /^\d{10}$/;

/**
 * The scheme tag a buyer tax id is rendered under when it has to become a STABLE
 * HANDLE rather than go onto a document.
 *
 * `TaxIdentifier.scheme` has been OPTIONAL since ADR-073 decision 1 - an order
 * stores a bare number and core may not mint a tag - so interpolating it raw
 * yields `undefined` inside a persisted identifier and splits ONE buyer across
 * two handles depending on which path issued. It resolves the domestic case the
 * same way either path would, and falls back to a literal marker rather than
 * ever rendering `undefined`.
 *
 * It deliberately does not throw for an untagged foreign value. A handle has no
 * document consequence, so refusing one would fail `upsertCustomer` for a buyer
 * the adapter can otherwise serve perfectly well.
 */
export function resolveBuyerHandleSchemeTag(scheme: string | undefined, value: string): string {
  if (scheme !== undefined && scheme.trim().length > 0) {
    return scheme.trim().toLowerCase();
  }
  return DOMESTIC_TAX_ID_PATTERN.test(value.trim()) ? 'pl-nip' : 'untagged';
}

// ---------------------------------------------------------------------------
// Status -> neutral clearance
// ---------------------------------------------------------------------------

/**
 * Project a document status onto the neutral clearance result.
 *
 * The arms, in the order they are tested:
 *
 *   1. `processingMode: NONE` -> `not-applicable`. This is a statement about the
 *      DOCUMENT, not about its progress: no hub relay was requested, so there is
 *      no clearance to wait for and the invoice is complete. Tested first
 *      precisely because it is true at any status.
 *   2. `status: ERROR` -> `rejected`.
 *   3. `status: CONFIRMED` (with a hub relay) -> `cleared`, carrying the
 *      authority's own number as the neutral `clearanceReference`.
 *   4. anything else with a hub relay -> `pending-submission`.
 *
 * Arm 4 deliberately swallows `OFFLINE`, `PENDING` and any status this build does
 * not recognise into ONE answer, for two reasons. `OFFLINE` is the state the
 * neutral `pending-submission` was named for - issued, with legal effect, not yet
 * transmitted. `PENDING` precedes it, so mapping `PENDING` to `submitted` would
 * claim the authority already has a document that has not been issued yet, and
 * would then have to walk BACKWARDS to `pending-submission` on the next poll. An
 * unrecognised status lands here too, which is the safe reading: `pending-submission`
 * is non-terminal, so the reconciliation keeps polling and the answer self-heals,
 * whereas any terminal guess would stop it looking.
 *
 * NOTE for a reader tracing a record that never stops being polled: `cleared` is
 * NOT in the neutral terminal set (`accepted` / `rejected` / `not-applicable`), so
 * arm 3 leaves the record on the reconciliation's non-terminal predicate for good.
 * That is what this issue's status table specifies and is implemented as
 * specified; it is the same shape inFakt's #1293 finding recorded, and closing it
 * is a decision about the neutral vocabulary rather than about this mapper.
 */
export function toRegulatoryClearanceResult(
  body: EparagonyDocumentStatusResponse,
): RegulatoryClearanceResult {
  const processingMode = readUpper(body.processingMode);
  if (processingMode === EPARAGONY_PROCESSING_MODE_NONE) {
    return { regulatoryStatus: 'not-applicable', clearanceReference: null };
  }

  const status = readUpper(body.status);
  if (status === EPARAGONY_STATUS_ERROR) {
    return { regulatoryStatus: 'rejected', clearanceReference: null };
  }

  const clearanceReference = readClearanceReference(body);
  if (status === EPARAGONY_STATUS_CONFIRMED && processingMode === EPARAGONY_PROCESSING_MODE_KSEF) {
    return { regulatoryStatus: 'cleared', clearanceReference };
  }

  return { regulatoryStatus: 'pending-submission', clearanceReference };
}

/**
 * The authority-assigned number, once assigned. Absent at `OFFLINE` by design -
 * the authority has not minted one yet - so `null` here means "not yet", never
 * "this document has none".
 */
export function readClearanceReference(body: EparagonyDocumentStatusResponse): string | null {
  return readString(readKsefInvoice(body)?.ksefNumber);
}

/** The legal document number the vendor put on the invoice. */
export function readInvoiceNumber(body: EparagonyDocumentStatusResponse): string | null {
  return readString(body.invoiceNumber);
}

/**
 * The buyer-facing HTML view of the document.
 *
 * Unlike the receipt lane this is NOT gated on `CONFIRMED`: an invoice at
 * `OFFLINE` is already issued with legal effect, and its visualisation carries
 * the authority's offline QR codes, so withholding it would hide a document the
 * buyer is entitled to.
 */
export function readDocumentUrl(body: EparagonyDocumentStatusResponse): string | null {
  return readString(body.documentUrl);
}

/** The hub detail block, when the response carries a readable one. */
export function readKsefInvoice(
  body: EparagonyDocumentStatusResponse,
): EparagonyKsefInvoiceDetails | null {
  const raw = body.ksefInvoice;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  return raw as EparagonyKsefInvoiceDetails;
}

// ---------------------------------------------------------------------------
// Lines and money
// ---------------------------------------------------------------------------

function toPricedLine(line: InvoiceLine, orderId: string): PricedInvoiceLine {
  const code = resolveInvoiceTaxRateCode(line.taxRate);
  if (code === null) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot invoice order ${orderId}: line "${line.name}" carries tax rate ` +
        `"${line.taxRate}", which is not an invoice tax rate in this regime`,
      line.taxRate.trim().length === 0
        ? 'At least one order line carries no tax rate, and an invoice cannot state one on its behalf. Set the rate on the product and re-issue.'
        : 'At least one order line carries a tax rate that cannot be expressed on an invoice in this regime.',
    );
  }

  const quantity = toQuantityString(line.quantity);
  if (quantity === null) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot invoice order ${orderId}: line "${line.name}" has a non-invoiceable quantity ${line.quantity}`,
      'At least one order line has a quantity that cannot be invoiced.',
    );
  }

  const grossMinor = toMinorUnits(line.unitPriceGross * line.quantity);
  if (grossMinor === null || grossMinor < 0) {
    // The vendor's summary fields are unsigned, so a negative line cannot be
    // expressed at all - a credit is a correction document (#3193), not a
    // negative line on an original.
    throw new EparagonyConfigException(
      `eparagony.pl cannot invoice order ${orderId}: line "${line.name}" has a non-invoiceable total`,
      'At least one order line has a total that cannot be invoiced.',
    );
  }

  return { line, code, quantity, grossMinor };
}

/**
 * Group priced lines by rate code, preserving FIRST-SEEN order so the emitted
 * document is a deterministic function of the command - two identical commands
 * must produce byte-identical bodies, or the vendor's replay check on a repeated
 * idempotency key would see "the same key with different data".
 */
function groupByRate(
  priced: PricedInvoiceLine[],
): Map<EparagonyInvoiceTaxRate, PricedInvoiceLine[]> {
  const groups = new Map<EparagonyInvoiceTaxRate, PricedInvoiceLine[]>();
  for (const member of priced) {
    const existing = groups.get(member.code);
    if (existing === undefined) {
      groups.set(member.code, [member]);
    } else {
      existing.push(member);
    }
  }
  return groups;
}

/**
 * The line's net unit price.
 *
 * Derived from the line's ALLOCATED net rather than from the unit price on its
 * own, so `netUnitPrice x quantity` tracks `netTotalLineValue` as closely as
 * integer minor units allow. The two can still differ by a grosz on a fractional
 * quantity, which the vendor tolerates (`calculationValidation: NONE`, and its
 * own contract notes the total may additionally carry rebates) - and the figures
 * that must reconcile exactly, the per-rate summary, do.
 */
function resolveNetUnitPrice(lineNet: number, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return lineNet;
  }
  return roundMinorUnits(lineNet / quantity);
}

/**
 * Round a minor-unit amount that arithmetic has left fractional, half away from
 * zero.
 *
 * Deliberately NOT in `money.policy.ts`, whose documented job is the one
 * major-to-minor unit conversion the whole package shares. This is a VAT split,
 * i.e. regime arithmetic on amounts that are already in minor units, so it
 * belongs with the regime knowledge rather than with the unit conversion.
 *
 * The `toFixed(4)` collapse is the same guard `toMinorUnits` documents: binary
 * floats leave dust a hair below the tie (`100.49999999999999` for a true
 * `100.5`), which would round the wrong way.
 */
function roundMinorUnits(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const collapsed = Number(Math.abs(value).toFixed(4));
  const rounded = Math.sign(value) * Math.round(collapsed);
  return rounded === 0 ? 0 : rounded;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Project the neutral buyer address onto the vendor's five-part entity address.
 *
 * The vendor splits street from building number; the neutral shape does not, so
 * the split is inferred from the line's trailing token. A mis-split is COSMETIC
 * and cannot lose data - `street` plus `number` always re-reads as the original
 * line - which is what makes inferring acceptable here where it would not be for
 * a tax rate or an identifier.
 */
function toEntityAddress(address: BuyerAddress): EparagonyEntityAddress {
  const { street, number } = splitStreetAndNumber(address.line1);
  const apartment = readNonEmpty(address.line2);
  return {
    street,
    number,
    ...(apartment === null ? {} : { apartment }),
    postalCode: address.postalCode,
    city: address.city,
    country: address.countryIso2,
  };
}

/** The operator's own configured seller address, copied across unchanged. */
function toSellerEntityAddress(address: EparagonySellerAddress): EparagonyEntityAddress {
  const apartment = readNonEmpty(address.apartment);
  return {
    street: address.street,
    number: address.number,
    ...(apartment === null ? {} : { apartment }),
    postalCode: address.postalCode,
    city: address.city,
    country: address.country,
  };
}

export function splitStreetAndNumber(line1: string): { street: string; number: string } {
  const trimmed = line1.trim();
  const match = STREET_AND_NUMBER_PATTERN.exec(trimmed);
  if (match === null) {
    return { street: trimmed, number: UNKNOWN_BUILDING_NUMBER };
  }
  const street = match[1].trim();
  // A line that is nothing BUT a number leaves no street behind; keeping the
  // whole line as the street is the reading that loses nothing.
  return street.length === 0
    ? { street: trimmed, number: UNKNOWN_BUILDING_NUMBER }
    : { street, number: match[2] };
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/**
 * Render an instant as the calendar date it falls on in the REGIME's zone.
 *
 * `null` for an absent or unusable instant, and also when the runtime cannot
 * resolve the zone - the vendor stamps its own date when the field is omitted,
 * which is a better answer than a date that may be a day out.
 */
export function toRegimeCalendarDate(instant: Date | undefined): string | null {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    return null;
  }
  try {
    // `en-CA` renders `YYYY-MM-DD`, which is the shape the vendor wants.
    const rendered = new Intl.DateTimeFormat('en-CA', {
      timeZone: REGIME_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
    return CALENDAR_DATE_PATTERN.test(rendered) ? rendered : null;
  } catch {
    return null;
  }
}

function readNonEmpty(value: string | undefined | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readUpper(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().toUpperCase() : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
