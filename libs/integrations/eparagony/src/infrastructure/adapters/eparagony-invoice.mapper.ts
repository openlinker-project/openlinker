/**
 * eparagony.pl Invoice Mapper
 *
 * Pure translation between the neutral invoicing vocabulary and the vendor's
 * `eInvoice` wire shapes. The sibling of `eparagony-document.mapper.ts`, and
 * deliberately a SEPARATE file: the two document kinds share an endpoint and a
 * status read, and share no field, no rate vocabulary and no arithmetic.
 *
 * Two directions:
 *   - {@link composeInvoiceDocument} / {@link composeCorrectiveInvoiceDocument} -
 *     neutral command -> `POST /documents` body, plus the same per-line figures
 *     in the neutral vocabulary. The two share one arithmetic core,
 *     `composeLineSet`, which a correction runs TWICE: over the original
 *     ("before") lines and over the corrected ("after") ones.
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
 * THE GROUPING IS THE ARITHMETIC, NEVER THE DOCUMENT'S LINE ORDER. The emitted
 * `eInvoice.lines` array is in the order `command.lines` carries, because core
 * persists that array VERBATIM as the issued-line snapshot and pairs both
 * `IssuedDocumentLineAmounts.lineNumber` and a later correction's
 * `CorrectionLine.originalLineNumber` by 1-based position over it - so emitting
 * in rate-group order would have #3193's correction credit the wrong line on a
 * document already transmitted to a tax authority.
 *
 * AND THE FIGURES COME BACK OUT. Composition returns the per-line net, tax and
 * gross it put on the wire as {@link IssuedDocumentLineAmounts}; core's fallback
 * when an adapter reports nothing is a per-line `round(gross / (1 + r))`, i.e.
 * exactly the arithmetic rejected above, so OpenLinker's own contents card would
 * disagree with the paper on every order that needed a residual absorbed.
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
  CorrectionLine,
  InvoiceLine,
  IssueCorrectionCommand,
  IssueInvoiceCommand,
  IssuedDocumentLineAmounts,
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
  EPARAGONY_PROCESSING_MODE_NONE,
  EPARAGONY_STATUS_CONFIRMED,
  EPARAGONY_STATUS_ERROR,
  EPARAGONY_VAT_CALCULATION_SUM_OF_RATES_NET,
  type EparagonyCorrectedInvoiceMetadata,
  type EparagonyCorrectingInvoiceMetadata,
  type EparagonyCorrectiveInvoiceBody,
  type EparagonyCreateCorrectiveInvoiceRequest,
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
 * Minor units in one major unit of {@link SETTLEMENT_CURRENCY}. Declared here
 * rather than borrowed from `money.policy.ts` for the same reason
 * {@link roundMinorUnits} is: this is regime arithmetic on amounts that are
 * already converted, not the package-wide unit conversion.
 */
const MINOR_UNITS_PER_MAJOR = 100;

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

/**
 * What one composition pass produces: the wire body, and the SAME per-line
 * figures expressed in the neutral vocabulary.
 *
 * Both come out of one pass deliberately. Recomputing the neutral half from the
 * command would reintroduce the per-line rounding this file's arithmetic exists
 * to avoid, and recomputing it from the wire body would need the rate fractions
 * a second time - one pass makes "what we sent" and "what we report" the same
 * numbers by construction rather than by agreement.
 */
export interface ComposedInvoiceDocument {
  request: EparagonyCreateInvoiceRequest;
  /**
   * Per-line amounts as the issued document states them, in MAJOR units (the
   * neutral type's money idiom) and keyed by 1-based position in
   * `command.lines`, which is the position the document carries.
   */
  documentLines: IssuedDocumentLineAmounts[];
}

export interface CreateCorrectiveInvoiceRequestInput {
  command: IssueCorrectionCommand;
  config: EparagonyConnectionConfig;
  documentToken: string;
  transactionToken: string;
}

/**
 * What one corrective composition pass produces - the wire body, and the SAME
 * per-line CORRECTED ("after") figures {@link composeInvoiceDocument} would
 * report, keyed the same way `IssuedDocumentContent.lines` pairs against.
 */
export interface ComposedCorrectiveInvoiceDocument {
  request: EparagonyCreateCorrectiveInvoiceRequest;
  documentLines: IssuedDocumentLineAmounts[];
}

/** One rate-summarised composition of a line set, shared by an original and a correction. */
interface ComposedLineSet {
  lines: EparagonyInvoiceLine[];
  documentLines: IssuedDocumentLineAmounts[];
  /** Integer minor units. */
  grossSaleValue: number;
  netValueByTaxRate: Partial<Record<EparagonyInvoiceTaxRate, number>>;
  taxValueByTaxRate: Partial<Record<EparagonyTaxedInvoiceRate, number>>;
}

/** One line priced in minor units and resolved onto a vendor rate code. */
interface PricedInvoiceLine {
  line: InvoiceLine;
  /**
   * Zero-based position in `command.lines`, carried through the rate grouping
   * so the emitted array can be put back into the order the command gave. See
   * the module docblock: the grouping is an arithmetic device, and core pairs
   * everything downstream by document position.
   */
  index: number;
  code: EparagonyInvoiceTaxRate;
  quantity: string;
  grossMinor: number;
}

/**
 * WHY EVERY REFUSAL BELOW REPEATS ITS REMEDY IN THE `message`, NOT ONLY IN `reason`.
 *
 * `reason` is read in exactly ONE place on this lane:
 * `InvoiceService.classifyFailureCode` matches it against three marker lists and
 * then discards it. The operator-facing sentence is built by
 * `deriveFailureReason` from the resulting neutral `InvoiceFailureCode`, and
 * `errorMessage` is built by `sanitizeError` from `error.message`. So an
 * OL-authored `reason` that matches no marker reaches NOTHING - not
 * `failureReason`, not `errorMessage`, not the log - and the operator reads
 * "The invoicing provider rejected the request." for a request no provider saw.
 *
 * That is a lane gap, not an adapter one: the receipt lane's
 * `FiscalRegistrationService.deriveFailureReason` surfaces the adapter's reason
 * verbatim, with the same exception class. The real fix is a neutral code plus
 * its marker - `seller-tax-id-required` / `connection-config-required`, the shape
 * #3031 used for `sale-classification-required` - which is a core change with its
 * own slice.
 *
 * Until then, putting the remedy in the `message` is what makes it reachable at
 * all: `message` IS persisted, as `invoice_records.errorMessage`, and is what
 * `getInvoice` shows an operator and what the failure log carries. Two refusals
 * below have an operator remedy and repeat it there for that reason; the rest
 * describe an order that cannot be invoiced at all, where there is no remedy to
 * repeat.
 *
 * The `message` must stay clear of `TAX_ID_REJECTION_MARKERS` for the same reason
 * `reason` does: `classifyFailureCode` falls back to `error.message` whenever
 * `reason` is not a string, so the two texts are one haystack under refactoring.
 */
/**
 * Compose the `POST /documents` body for a VAT invoice, and the neutral per-line
 * figures that body states.
 *
 * @throws {EparagonyConfigException} when the sale cannot be expressed as an
 * invoice at all: a currency that would need an exchange rate, a connection with
 * no seller tax number, an unresolvable rate, or a non-registrable amount.
 */
export function composeInvoiceDocument(input: CreateInvoiceRequestInput): ComposedInvoiceDocument {
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
      // THE REMEDY IS IN THE MESSAGE, not only in `reason`, and that placement is
      // the whole mitigation - see the note above `composeInvoiceDocument`.
      `eparagony.pl cannot invoice order ${command.orderId}: the connection declares no seller ` +
        `tax number, which is mandatory on every invoice. Set it on the connection and re-issue`,
      // The wording says "tax NUMBER" on purpose, and a spec pins that on BOTH
      // texts: core's `TAX_ID_REJECTION_MARKERS` would read "tax id" here and
      // classify a missing CONNECTION field as `buyer-tax-id-invalid`, sending
      // the operator to correct the buyer's data instead.
      'This connection has no seller tax number set, which every invoice requires. Set it on the connection and re-issue.',
    );
  }

  if (command.lines.length === 0) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot invoice order ${command.orderId}: it has no lines`,
      'The order has no lines, so there is nothing to invoice.',
    );
  }

  const { lines, documentLines, grossSaleValue, netValueByTaxRate, taxValueByTaxRate } =
    composeLineSet(command.lines, command.orderId);

  const metadata: EparagonyInvoiceMetadata = {
    vatCalculationMethod: EPARAGONY_VAT_CALCULATION_SUM_OF_RATES_NET,
    calculationValidation: EPARAGONY_CALCULATION_VALIDATION_NONE,
    grossSaleValue,
    merchantTIN,
    consumerName: command.buyer.name,
    consumerAddress: toEntityAddress(command.buyer.address, command.orderId),
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
  // Only a COMPLETE address is stamped. `config` is JSONB and the raw editor is
  // a route around the connection form, so a half-filled object is reachable
  // even with the shape validator in front of it - and a blank `street` on a
  // required field is a vendor rejection of a real paid order, while a rendered
  // `"undefined"` is worse still because it succeeds.
  const merchantAddress = readSellerEntityAddress(config.merchantAddress);
  if (merchantAddress !== null) {
    metadata.merchantAddress = merchantAddress;
  }

  // REQUIRED in practice (#3500): the vendor does not generate the legal
  // number itself - `POST /documents` rejects a request with no
  // `invoiceNumber` with an opaque `errorCode: 99`. `EparagonyInvoicingAdapter`
  // is a `DocumentNumberConsumer`, so core always allocates one from the
  // connection's numbering series and sets `command.documentNumber` before
  // reaching this mapper; the `readNonEmpty` guard stays defensive for a
  // caller that constructs the command directly without going through core.
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

  return {
    request: { posId: config.posId, documentToken, transactionToken, eInvoice },
    documentLines,
  };
}

/**
 * Compose the `POST /documents` body for a `PDVatCorrectiveInvoice` - the
 * vendor's `eCorrectiveInvoice` document kind (#3193).
 *
 * The command's `originalDocument` snapshot is the ONLY source of the original
 * document's facts, per its own contract (#1297): it is caller-assembled from
 * the issuance-time line snapshot, so it reflects the document AS ISSUED rather
 * than the order's possibly-edited current state. Nothing here re-derives those
 * facts from anywhere else.
 *
 * The correction's own composed lines are the ORIGINAL lines with each
 * {@link CorrectionLine}'s deltas applied - a line not named by any correction
 * entry carries through UNCHANGED, because `correctingMetadata` and `metadata`
 * state the document's full post-correction totals rather than a diff.
 *
 * @throws {EparagonyConfigException} when the correction cannot be expressed at
 * all: no original-document snapshot, a currency that would require an exchange
 * rate, a connection missing the seller identity a correction requires
 * (`merchantTIN` AND `merchantName` AND a complete `merchantAddress` - all
 * three, unlike a plain invoice where the latter two are optional), an original
 * with no usable legal number or issue date, an unresolvable rate, a
 * non-invoiceable amount, or a correction line naming a position the original
 * document does not have.
 */
export function composeCorrectiveInvoiceDocument(
  input: CreateCorrectiveInvoiceRequestInput,
): ComposedCorrectiveInvoiceDocument {
  const { command, config, documentToken, transactionToken } = input;
  const orderId = command.orderId;

  const originalDocument = command.originalDocument;
  if (originalDocument === undefined) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot correct order ${orderId}: no original-document snapshot was supplied`,
      'This document cannot be corrected: OpenLinker holds no reconstructable snapshot of the original invoice.',
    );
  }

  const currency = originalDocument.currency.trim().toUpperCase();
  if (currency !== SETTLEMENT_CURRENCY) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot correct order ${orderId}: currency ${currency} would require an ` +
        `exchange rate this adapter has no authoritative source for`,
      // "unsupported currency" is one of core's CURRENCY_REJECTION_MARKERS, so
      // this refusal reaches the operator as `invalid-currency` rather than as
      // the generic provider-rejected copy - the same wording the issue path uses.
      `Unsupported currency for this invoicing connection: it issues in ${SETTLEMENT_CURRENCY} only.`,
    );
  }

  const merchantTIN = readNonEmpty(config.merchantTIN);
  if (merchantTIN === null) {
    throw new EparagonyConfigException(
      // THE REMEDY IS IN THE MESSAGE - see the note above `composeInvoiceDocument`.
      `eparagony.pl cannot correct order ${orderId}: the connection declares no seller tax ` +
        `number, which is mandatory on every correction. Set it on the connection and re-issue`,
      // "tax NUMBER", never "tax id", for the reason the issue path states: core's
      // `TAX_ID_REJECTION_MARKERS` would classify a missing CONNECTION field as a
      // problem with the BUYER's data.
      'This connection has no seller tax number set, which every correction requires. Set it on the connection and re-issue.',
    );
  }

  // `merchantName` / `merchantAddress` are OPTIONAL on a plain invoice - the
  // vendor falls back to the account's own registered identity - but REQUIRED on
  // `correctingMetadata`, which carries no such fallback. Refusing here rather
  // than sending an incomplete body turns an opaque vendor validation code into
  // a refusal that names the connection field to fill in.
  const merchantName = readNonEmpty(config.merchantName);
  if (merchantName === null) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot correct order ${orderId}: the connection declares no seller name, ` +
        `which every correction requires. Set it on the connection and re-issue`,
      'This connection has no seller name set, which every correction requires. Set it on the connection and re-issue.',
    );
  }
  // Read through the SAME completeness check the issue path uses, so a
  // half-filled address (reachable through the raw JSON editor, and through any
  // connection configured before the shape validator shipped) reads as absent
  // rather than rendering "undefined undefined" onto a fiscal document.
  const merchantAddress = readSellerEntityAddress(config.merchantAddress);
  if (merchantAddress === null) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot correct order ${orderId}: the connection declares no complete seller ` +
        `address, which every correction requires. Set it on the connection and re-issue`,
      'This connection has no complete seller address set, which every correction requires. Set it on the connection and re-issue.',
    );
  }

  const originalDocumentNumber = readNonEmpty(originalDocument.documentNumber);
  if (originalDocumentNumber === null) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot correct order ${orderId}: the original document carries no legal number`,
      'The document being corrected has no legal number on file, so the correction cannot reference it.',
    );
  }
  // Shape-checked, never reformatted - the same treatment `saleEndDate` gets on
  // the issue path. A value the vendor would refuse is better refused here, where
  // the message can name the document rather than the field.
  if (!CALENDAR_DATE_PATTERN.test(originalDocument.issueDate)) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot correct order ${orderId}: the original document's issue date ` +
        `"${originalDocument.issueDate}" is not a YYYY-MM-DD calendar date`,
      'The document being corrected has no usable issue date on file, so the correction cannot reference it.',
    );
  }

  if (originalDocument.lines.length === 0) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot correct order ${orderId}: the original document has no lines`,
      'The document being corrected has no lines, so there is nothing to correct.',
    );
  }
  if (command.lines.length === 0) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot correct order ${orderId}: the correction names no lines`,
      'The correction names no lines, so there is nothing to change.',
    );
  }

  const correctedFinalLines = applyCorrectionLines(originalDocument.lines, command.lines, orderId);

  // Both halves go through the identical rule, which is what keeps the "before"
  // and "after" totals comparable rather than merely adjacent.
  const original = composeLineSet(originalDocument.lines, orderId);
  const corrected = composeLineSet(correctedFinalLines, orderId);

  const consumerName = originalDocument.buyer.name;
  const consumerAddress = toEntityAddress(originalDocument.buyer.address, orderId);

  const correctedMetadata: EparagonyCorrectedInvoiceMetadata = {
    invoiceNumber: originalDocumentNumber,
    invoiceDate: originalDocument.issueDate,
    grossSaleValue: original.grossSaleValue,
  };

  const correctingMetadata: EparagonyCorrectingInvoiceMetadata = {
    merchantTIN,
    merchantName,
    merchantAddress,
    consumerName,
    consumerAddress,
    grossSaleValue: corrected.grossSaleValue,
  };

  const metadata: EparagonyInvoiceMetadata = {
    vatCalculationMethod: EPARAGONY_VAT_CALCULATION_SUM_OF_RATES_NET,
    calculationValidation: EPARAGONY_CALCULATION_VALIDATION_NONE,
    grossSaleValue: corrected.grossSaleValue,
    merchantTIN,
    merchantName,
    merchantAddress,
    consumerName,
    consumerAddress,
    netValueByTaxRate: corrected.netValueByTaxRate,
    taxValueByTaxRate: corrected.taxValueByTaxRate,
    currency: SETTLEMENT_CURRENCY,
    orderId,
  };

  // The buyer's own tax number travels verbatim off the ISSUED snapshot, never
  // re-read from the order (ADR-073 decision 5, and #1297's whole point).
  const consumerTIN = readNonEmpty(originalDocument.buyer.taxId?.value);
  if (consumerTIN !== null) {
    metadata.consumerTIN = consumerTIN;
  }

  // The CORRECTION's own number, allocated by core (#3500) - never the
  // original's, which lives only on `correctedMetadata`. Required the same
  // way the plain issue path requires it: the vendor rejects a document with
  // no `invoiceNumber`, it does not generate one itself.
  const documentNumber = readNonEmpty(command.documentNumber);
  if (documentNumber !== null) {
    metadata.invoiceNumber = documentNumber;
  }

  const invoiceDate = toRegimeCalendarDate(command.issuedAt);
  if (invoiceDate !== null) {
    metadata.invoiceDate = invoiceDate;
  }

  const eCorrectiveInvoice: EparagonyCorrectiveInvoiceBody = {
    invoiceType: EPARAGONY_INVOICE_TYPE_VAT,
    metadata,
    correctedMetadata,
    correctingMetadata,
    // Optional on the vendor's type and sent anyway: the two summaries state
    // totals, and without the lines an operator reading the issued correction
    // cannot see WHICH position moved.
    correctedLines: original.lines,
    correctingLines: corrected.lines,
  };

  const reason = readNonEmpty(command.reason);
  if (reason !== null) {
    eCorrectiveInvoice.correctionReason = reason;
  }
  if (config.eInvoicingHubEnabled === true) {
    // On the `eCorrectiveInvoice` object ITSELF, exactly as the hub marker sits
    // on `eInvoice` - not inside `extensions`.
    eCorrectiveInvoice.eInvoicingHub = EPARAGONY_EINVOICING_HUB_KSEF;
  }

  return {
    request: { posId: config.posId, documentToken, transactionToken, eCorrectiveInvoice },
    documentLines: corrected.documentLines,
  };
}

/**
 * The original ("before") lines with each {@link CorrectionLine}'s delta
 * applied, in the original order and at the original 1-based positions. A line
 * no correction entry names carries through UNCHANGED - the vendor's
 * `correctingMetadata` states the document's full post-correction totals, so
 * every original line must be represented in the "after" state whether or not
 * it changed.
 *
 * Never mutates the caller-assembled snapshot: every changed line is a fresh
 * object, which matters because core persists that same array.
 *
 * @throws {EparagonyConfigException} when a correction entry names a position
 * outside `[1, originalLines.length]`, or the same position more than once -
 * either would silently misattribute a delta to the wrong line, or drop it.
 */
function applyCorrectionLines(
  originalLines: readonly InvoiceLine[],
  corrections: readonly CorrectionLine[],
  orderId: string,
): InvoiceLine[] {
  const byLineNumber = new Map<number, CorrectionLine>();
  for (const correction of corrections) {
    if (
      !Number.isInteger(correction.originalLineNumber) ||
      correction.originalLineNumber < 1 ||
      correction.originalLineNumber > originalLines.length
    ) {
      throw new EparagonyConfigException(
        `eparagony.pl cannot correct order ${orderId}: correction line number ` +
          `${String(correction.originalLineNumber)} does not name a line on the original document ` +
          `(it has ${String(originalLines.length)} line(s))`,
        'The correction refers to a line that does not exist on the original document.',
      );
    }
    if (byLineNumber.has(correction.originalLineNumber)) {
      throw new EparagonyConfigException(
        `eparagony.pl cannot correct order ${orderId}: correction line number ` +
          `${String(correction.originalLineNumber)} is named more than once`,
        'The correction names the same original line more than once.',
      );
    }
    byLineNumber.set(correction.originalLineNumber, correction);
  }

  return originalLines.map((line, index) => {
    const correction = byLineNumber.get(index + 1);
    if (correction === undefined) {
      return line;
    }
    return {
      ...line,
      quantity: correction.newQuantity ?? line.quantity,
      unitPriceGross: correction.newUnitPriceGross ?? line.unitPriceGross,
    };
  });
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
  // Read through the same completeness check the wire body uses, so what core
  // PERSISTS and what the vendor RECEIVES can never describe different sellers.
  // A partial object reads as no address at all: `${street} ${number}` on a
  // half-filled one renders the literal "undefined undefined" into a snapshot
  // core keeps forever, where an operator reads it as the seller's real address.
  const address = readSellerEntityAddress(config.merchantAddress);
  if (name === null || taxId === null || address === null) {
    return null;
  }
  return {
    name,
    // The adapter supplies the scheme tag, exactly as ADR-073 decision 1 says it
    // must - core holds a bare number and may not mint one.
    taxId: { scheme: 'pl-nip', value: taxId },
    address: {
      line1: `${address.street} ${address.number}`.trim(),
      line2: address.apartment ?? null,
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
 *   3. `status: CONFIRMED` -> `accepted`, carrying the authority's own number
 *      as the neutral `clearanceReference`.
 *   4. anything else -> `pending-submission`.
 *
 * Arm 3 deliberately does NOT re-test the processing mode. Arm 1 has already
 * returned for `NONE`, so a `CONFIRMED` document reaching arm 3 either relays to
 * the hub or carries a mode this build cannot read - and re-testing would send
 * that second case to arm 4, where `pending-submission` is non-terminal AND
 * STABLE: `CONFIRMED` is the vendor's terminal status, so it never moves again
 * and the #1121 reconciliation polls a finished document for ever. The
 * self-healing argument below holds for an unrecognised STATUS, which will
 * change; it does not hold for an unrecognised MODE on a settled one. Such a
 * document reports `clearanceReference: null`, which is the honest reading -
 * no hub number was there to read.
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
 * A CONFIRMED document relayed to the authority maps to `accepted`, NOT to
 * `cleared`, deliberately and against an earlier draft of this issue's status
 * table. Three independent facts in the tree say `cleared` is the wrong value.
 * It is absent from `TerminalRegulatoryStatusValues`, so the #1121
 * reconciliation would poll a finished document for ever - the shape inFakt's
 * #1293 finding recorded. The invoice list filters it out by name as "a reserved
 * status no provider emits". And KSeF's OWN adapter maps that same authority's
 * terminal success to `accepted`, commenting it "Cleared; KSeF assigned a
 * number" - so `accepted` already MEANS cleared-with-a-number in this
 * vocabulary. eparagony relays to the same authority KSeF talks to directly;
 * two adapters reaching one authority must not report its terminal success
 * under two different neutral values.
 *
 * `cleared` stays reserved for a split-clearance regime that genuinely needs a
 * state between submission and final acceptance. This is not one.
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
  if (status === EPARAGONY_STATUS_CONFIRMED) {
    return { regulatoryStatus: 'accepted', clearanceReference };
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

/**
 * The shared arithmetic core of {@link composeInvoiceDocument} AND
 * {@link composeCorrectiveInvoiceDocument} - price every line, group by rate,
 * split gross into net + tax PER GROUP (never per line, see the module
 * docblock), then emit the wire lines and the neutral `documentLines` in the
 * order the input carries.
 *
 * A correction calls this TWICE - once over the original ("before") lines, once
 * over the corrected ("after") lines - so both halves of that document are
 * computed by the identical rule and their totals are comparable rather than
 * merely adjacent.
 */
function composeLineSet(lines: readonly InvoiceLine[], orderId: string): ComposedLineSet {
  const priced = lines.map((line, index) => toPricedLine(line, index, orderId));
  const groups = groupByRate(priced);

  // Each line's share of its rate group's net, indexed by the line's ORIGINAL
  // position. Filled by the rate-group pass and read back by the emit pass -
  // which is the whole mechanism that keeps the ARITHMETIC per group while the
  // emitted document stays in the order the input gave. Pre-filled rather than
  // grown, so the emit pass reads a value for every line by construction.
  const netByIndex = priced.map(() => 0);
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

    const allocation = allocateGroupNet(members, netGroup, fraction);
    members.forEach((member, memberIndex) => {
      netByIndex[member.index] = allocation[memberIndex];
    });
  }

  // Emitted in the order `lines` carries, NOT in rate-group order - see the
  // module docblock. `documentLines` is built in the same pass from the same
  // numbers, so the reported figures cannot drift from the transmitted ones.
  const wireLines: EparagonyInvoiceLine[] = [];
  const documentLines: IssuedDocumentLineAmounts[] = [];
  for (const member of priced) {
    const lineNet = netByIndex[member.index];
    const netUnitPrice = resolveNetUnitPrice(lineNet, member.line.quantity);
    // Required on every line, including a zero-rated one, where it is 0.
    const taxValue = member.grossMinor - lineNet;

    wireLines.push({
      productOrServiceName: member.line.name,
      quantity: member.quantity,
      netUnitPrice,
      netTotalLineValue: lineNet,
      taxRate: member.code,
      taxValue,
    });
    documentLines.push({
      // 1-based position on the document, which is the position in `lines` -
      // the key core pairs `IssuedDocumentContent.lines` on.
      lineNumber: member.index + 1,
      unitNet: toMajorUnits(netUnitPrice),
      net: toMajorUnits(lineNet),
      tax: toMajorUnits(taxValue),
      gross: toMajorUnits(member.grossMinor),
    });
  }

  return { lines: wireLines, documentLines, grossSaleValue, netValueByTaxRate, taxValueByTaxRate };
}

function toPricedLine(line: InvoiceLine, index: number, orderId: string): PricedInvoiceLine {
  const code = resolveInvoiceTaxRateCode(line.taxRate);
  if (code === null) {
    // The remedy rides in the MESSAGE as well as in `reason`, for the reason
    // recorded above `composeInvoiceDocument`: `reason` matches none of core's
    // three marker lists, so `classifyFailureCode` answers `provider-rejected`
    // and the operator would otherwise read "the provider rejected the request"
    // about a request no provider saw. This one is worth the words:
    // `OL_TAX_RATE_STRICT_ENABLED` is OFF by default and `toShippingLines` emits
    // `taxRate: ''` when the split is uncomputable, so on a catalogue with
    // partial rate coverage this adapter refuses where inFakt, Subiekt and KSeF
    // all issue - and the operator needs to be told WHICH product to fix.
    const isRateless = line.taxRate.trim().length === 0;
    throw new EparagonyConfigException(
      `eparagony.pl cannot invoice order ${orderId}: line "${line.name}" carries tax rate ` +
        `"${line.taxRate}", which is not an invoice tax rate in this regime` +
        (isRateless ? '. Set the rate on the product and re-issue' : ''),
      isRateless
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

  return { line, index, code, quantity, grossMinor };
}

/**
 * Group priced lines by rate code, preserving FIRST-SEEN order.
 *
 * The order no longer decides the LINE order - lines are emitted in command
 * order - but it still decides the KEY order of the two per-rate summary maps,
 * and therefore the bytes of the serialized body. Two identical commands must
 * produce byte-identical bodies, or the vendor's replay check on a repeated
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
 * Split a rate group's net across its members, in minor units.
 *
 * The LAST member absorbs the residual - each earlier line rounds independently
 * and the last is whatever is left - so the group's lines sum back to the
 * group's own summary exactly rather than to within a grosz of it. That is the
 * rule, and the residual lands on the last member OF THIS GROUP, which is not
 * in general the last line of the document.
 *
 * THE RESIDUAL CAN LAND OUTSIDE WHAT ONE LINE CAN HOLD, IN EITHER DIRECTION,
 * which is the one case the rule alone does not cover. The invariant every
 * emitted line needs is `0 <= net_i <= gross_i`, because the wire carries the
 * line's net AND its tax as `gross_i - net_i`, so a net below zero is a negative
 * net and a net above the line's own gross is a NEGATIVE TAX - both onto a
 * document bound for a tax authority, and both invisible to the summary checks,
 * which reconcile perfectly either way. `calculationValidation: NONE` means the
 * vendor does not catch them either.
 *
 * Only the last member can violate it: every earlier entry is
 * `round(g / (1 + f))` with `f >= 0`, which is in `[0, g]` by construction.
 *
 * Below zero. Ten lines of one grosz at 23%: the group's gross is 10, its tax
 * rounds to 2 and its net is 8, while the first nine lines each round to 1, so
 * the tenth computes `8 - 9 = -1`.
 *
 * Above its own gross. Three lines of 3, 3 and 1 grosz at 23%: the group's gross
 * is 7, its tax rounds to 1 and its net is 6, while the first two lines round to
 * 2 each, so the third computes `6 - 4 = 2` against a gross of 1 - and the
 * emitted `taxValue` is `1 - 2 = -1`. This is NOT a constructed edge:
 * `toShippingLines` appends a small per-rate share LAST and {@link groupByRate}
 * preserves first-seen order, so a shipping share is the last member of its
 * group whenever its rate already appeared above it.
 *
 * Refusing either case would be the worse answer, because both ARE expressible:
 * they are real, paid orders, and a permanent domain rejection of one is the
 * failure shape ANALYSIS-1032 names a defect. So the excess is moved onto
 * earlier members instead, nearest first, taking at most the headroom each one
 * has (`g_i - a_i`) or at most what each one holds (`a_i`) depending on the
 * direction. NEITHER REPAIR CAN RUN OUT. The allocation always sums to
 * `netGroup`, so for the shortfall the others hold strictly more than it; and
 * for the surplus the earlier headroom is `taxGroup + surplus`, which is at
 * least the surplus because `taxGroup` is never negative.
 *
 * The group's total is untouched either way, which is what the summary
 * reconciles against. What the repair DOES change is one line's effective rate:
 * a line that lent its headroom can end at 0% and a line that was borrowed from
 * can end at 100% (ten 1-grosz lines at 23% leave two lines at `net 0, tax 1`).
 * That is a consequence of expressing sub-grosz VAT on a per-line document at
 * all, and it is the honest version of it - the alternative is a figure the
 * arithmetic cannot support.
 */
function allocateGroupNet(
  members: readonly PricedInvoiceLine[],
  netGroup: number,
  fraction: number,
): number[] {
  const allocation: number[] = [];
  let allocatedNet = 0;
  members.forEach((member, index) => {
    const isLast = index === members.length - 1;
    const lineNet = isLast
      ? netGroup - allocatedNet
      : roundMinorUnits(member.grossMinor / (1 + fraction));
    allocation.push(lineNet);
    allocatedNet += lineNet;
  });

  // A group always has at least one member, so this index exists.
  const lastIndex = allocation.length - 1;
  const lastGross = members[lastIndex].grossMinor;

  // Above the line's own gross: `gross - net` is the tax the wire carries, so
  // this is a NEGATIVE tax. The excess is lent to earlier lines that still have
  // headroom.
  let surplus = allocation[lastIndex] - lastGross;
  if (surplus > 0) {
    allocation[lastIndex] = lastGross;
    for (let index = lastIndex - 1; index >= 0 && surplus > 0; index -= 1) {
      const headroom = members[index].grossMinor - allocation[index];
      const lent = Math.min(headroom, surplus);
      allocation[index] += lent;
      surplus -= lent;
    }
    return allocation;
  }

  // Below zero: a negative net. The shortfall is borrowed back from earlier
  // lines, taking at most what each one holds so none of them goes negative.
  let shortfall = -allocation[lastIndex];
  if (shortfall <= 0) {
    return allocation;
  }

  allocation[lastIndex] = 0;
  for (let index = lastIndex - 1; index >= 0 && shortfall > 0; index -= 1) {
    const borrowed = Math.min(allocation[index], shortfall);
    allocation[index] -= borrowed;
    shortfall -= borrowed;
  }
  return allocation;
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
  // UNREACHABLE today - `toPricedLine` refuses a non-positive or non-finite
  // quantity several lines earlier, via `toQuantityString`. Kept so the division
  // below cannot produce an infinity if that order ever changes, and noted so
  // the next reader does not hunt for the input that reaches it.
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return lineNet;
  }
  return roundMinorUnits(lineNet / quantity);
}

/**
 * Render an integer minor-unit amount as the major-unit decimal the neutral
 * vocabulary carries.
 *
 * {@link IssuedDocumentLineAmounts} is a plain `number` in major units, and a
 * bare division leaves binary dust on most values, so the quotient is collapsed
 * at the currency's own precision rather than passed on raw.
 */
function toMajorUnits(minor: number): number {
  return Number((minor / MINOR_UNITS_PER_MAJOR).toFixed(2));
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
 *
 * A NON-FINITE INPUT THROWS rather than answering `0`. The branch is
 * UNREACHABLE today - every amount reaching it has already been through
 * `toMinorUnits`, which refuses a non-finite value, and every rate fraction is a
 * table constant - so this is a defence and not a behaviour. But a silent `0`
 * inside a VAT split is the worst possible answer: the group's net and tax would
 * still add back to its gross, the summary would reconcile, nothing would be
 * logged, and the document would understate the tax. Better to fail the whole
 * composition before anything is sent.
 */
function roundMinorUnits(value: number): number {
  if (!Number.isFinite(value)) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot invoice: a tax split produced the non-finite amount ${value}`,
      'This order produced an amount that cannot be stated on an invoice.',
    );
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
 * the split is inferred from the line's trailing token. Concatenating `street`
 * and `number` always re-reads as the original line, so nothing is LOST - but a
 * mis-split can MIS-ASSIGN the building number, which is not the same claim: on
 * the common Polish `ul. Kwiatowa 12 m. 8` form the apartment lands in the
 * vendor's building-number field on a document bound for the national hub. That
 * is still the right trade against refusing a real paid order over a formatting
 * detail, and it is a weaker guarantee than a tax rate or an identifier gets,
 * which both travel verbatim.
 */
function toEntityAddress(address: BuyerAddress, orderId: string): EparagonyEntityAddress {
  // A PRESENCE check, not a validity one, which is why it does not contradict
  // ADR-073 decision 5 (never pre-judge a value the vendor judges): `street`,
  // `postalCode`, `city` and `country` are REQUIRED on the vendor's own type,
  // and `BuyerAddress` guarantees none of them is non-empty. A blank `street`
  // would be sent and rejected with an opaque validation code; the FORMAT of a
  // present value still travels verbatim for the vendor to judge, as the foreign
  // postcode spec pins.
  //
  // WHAT THIS DOES AND DOES NOT REACH ON A HASH-ONLY DEPLOYMENT. Under
  // `OL_STORE_PII=false` core's `redactAddress` writes a non-empty placeholder
  // into `address1`, `city` and `postalCode`, so those three still pass here and
  // the placeholder reaches the document exactly as it did before - a
  // pre-existing question for the wiring slice, not something this check
  // changes. `country` is the exception: redaction writes `address.country ?? ''`,
  // so an order whose source reported no country refuses here where it
  // previously reached the vendor. That is the right direction - the field is
  // required and the vendor would refuse it anyway, with a code the operator
  // cannot act on.
  const line1 = readNonEmpty(address.line1);
  const postalCode = readNonEmpty(address.postalCode);
  const city = readNonEmpty(address.city);
  const country = readNonEmpty(address.countryIso2);
  if (line1 === null || postalCode === null || city === null || country === null) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot invoice order ${orderId}: the buyer's address is missing a part an ` +
        `invoice must state (street line, postcode, city or country). Complete the buyer's ` +
        `address on the order and re-issue`,
      "The buyer's address is missing a part every invoice must state. Complete it on the order and re-issue.",
    );
  }

  const { street, number } = splitStreetAndNumber(line1);
  const apartment = readNonEmpty(address.line2);
  return {
    street,
    number,
    ...(apartment === null ? {} : { apartment }),
    postalCode,
    city,
    country,
  };
}

/**
 * The operator's own configured seller address, or `null` when it is absent or
 * incomplete.
 *
 * Every required part is read rather than copied, which is the same defence the
 * shape validator applies at the connection boundary rather than a replacement
 * for it: `Connection.config` is JSONB, the raw JSON editor bypasses the form,
 * and a connection configured before the validator shipped was never checked at
 * all. The five parts are required on the vendor's own type, so a missing one is
 * not a degraded address - it is not an address.
 *
 * AN EXPLICIT `null` READS AS ABSENT, and that half is load-bearing on its own.
 * The shape validator blesses `null` here - the repo's cleared-knob convention
 * (#2610: clearing a knob writes an explicit `null` rather than deleting the
 * key, and every reader treats it exactly like absent), and what the seller form
 * writes when an operator clears the address. A guard testing `undefined` alone
 * let that value through to a field-by-field copy whose first statement
 * dereferences it: a raw `TypeError` on the live issue path, which core cannot
 * classify and therefore defaults to `in-doubt`, blocking that order from EVERY
 * sales document on every connection for a request that never crossed the
 * network (#3274).
 *
 * BOTH CALLERS read through this ONE function for that reason.
 * `toIssuedDocumentSeller` runs inside `toIssueResult`, AFTER `createDocument`
 * and its status poll have succeeded, so a guard fixed only in the composer
 * would relocate the same crash to a point where the vendor has already created
 * a legally-issued document that OpenLinker then loses.
 */
function readSellerEntityAddress(
  address: EparagonySellerAddress | undefined,
): EparagonyEntityAddress | null {
  if (address === undefined || address === null || typeof address !== 'object') {
    return null;
  }
  const street = readNonEmpty(address.street);
  const number = readNonEmpty(address.number);
  const postalCode = readNonEmpty(address.postalCode);
  const city = readNonEmpty(address.city);
  const country = readNonEmpty(address.country);
  if (
    street === null ||
    number === null ||
    postalCode === null ||
    city === null ||
    country === null
  ) {
    return null;
  }
  const apartment = readNonEmpty(address.apartment);
  return {
    street,
    number,
    ...(apartment === null ? {} : { apartment }),
    postalCode,
    city,
    country,
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
