/**
 * eparagony.pl Document Mapper
 *
 * Pure translation between the neutral fiscalization vocabulary and the vendor's
 * wire shapes. All regime knowledge that ADR-042 decision 4 keeps out of core
 * lives here: rate letters, grosze, the seven device slots, the receipt
 * envelope.
 *
 * Two directions:
 *   - {@link toCreateReceiptRequest} - neutral command -> `POST /documents` body.
 *   - {@link toRegisterTransactionResult} / {@link toLocateResult} - document
 *     status -> the neutral identity set.
 *
 * No I/O, no framework, no logger: every branch is a function of its arguments,
 * which is what makes the failure semantics unit-testable without a transport.
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters
 */
import type {
  FiscalArtefact,
  FiscalLocateResult,
  FiscalTransactionLine,
  RegisterTransactionCommand,
  RegisterTransactionResult,
} from '@openlinker/core/fiscalization';

import { EPARAGONY_PROVIDER_TYPE } from '../../eparagony.constants';
import { EparagonyConfigException } from '../../domain/exceptions/eparagony-config.exception';
import { toMinorUnits, toQuantityString } from '../../domain/policies/money.policy';
import {
  resolveTaxRateCode,
  resolveTaxRateTable,
} from '../../domain/policies/tax-rate.policy';
import {
  EPARAGONY_STATUS_CONFIRMED,
  type EparagonyCreateReceiptRequest,
  type EparagonyDocumentStatusResponse,
  type EparagonyReceiptLine,
  type EparagonyReceiptProductLine,
} from '../../domain/types/eparagony-api.types';
import {
  EPARAGONY_PAYMENT_FORM_WIRE,
  type EparagonyConnectionConfig,
  type EparagonyTaxRateTable,
} from '../../domain/types/eparagony-config.types';

/** Label attached to the balancing line when the sale total differs from the line sum. */
const BALANCING_LINE_NAME = 'Order adjustment';

/** Default payment form: a prepaid e-commerce order is honestly a transfer. */
const DEFAULT_PAYMENT_FORM = 'Przelew';

/** Operator-facing label on the buyer-facing receipt link. */
const RECEIPT_LINK_LABEL = 'Receipt';

export interface CreateReceiptRequestInput {
  command: RegisterTransactionCommand;
  config: EparagonyConnectionConfig;
  documentToken: string;
  transactionToken: string;
}

/**
 * Compose the `POST /documents` body for a receipt.
 *
 * Throws {@link EparagonyConfigException} (`failureMode: 'rejected'`, nothing
 * sent) when the sale cannot be expressed as a receipt at all: an unresolvable
 * tax rate, a non-registrable quantity, or a non-finite amount. Blocking is the
 * ADR's stated behaviour - a fiscal document the seller is answerable for must
 * never carry a rate nobody declared.
 */
export function toCreateReceiptRequest(
  input: CreateReceiptRequestInput,
): EparagonyCreateReceiptRequest {
  const { command, config, documentToken, transactionToken } = input;
  const table = resolveTaxRateTable(config.taxRates);

  const productLines = command.lines.map((line) =>
    toProductLine(line, table, config, command.orderId),
  );

  const grossSaleValue = toMinorUnits(command.totalGross);
  if (grossSaleValue === null || grossSaleValue < 0) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot register order ${command.orderId}: total ${command.totalGross} is not a registrable amount`,
      'The order total is not a registrable amount, so no e-receipt was requested.',
    );
  }

  const lines: EparagonyReceiptLine[] = [...productLines];
  const balancing = grossSaleValue - productLines.reduce((sum, l) => sum + l.totalLineValue, 0);
  if (balancing < 0) {
    // The buyer-paid total is LESS than the sum of the taxed positions -
    // typically an order-level discount the neutral command carries only inside
    // the total. A whole-receipt REBATE line carries no rate of its own, so the
    // device distributes it proportionally across the rates already present.
    // That is the only way to reconcile the two without inventing a taxed
    // position, and it is what keeps the vendor's declared-payment check
    // (`errorCode: 87`) satisfied.
    lines.push({ type: 'REBATE', value: balancing, name: BALANCING_LINE_NAME });
  } else if (balancing > 0) {
    // The vendor's own type permits a positive `value` here as a markup, but
    // core's upstream reconciliation (`assertLinesSumToTotal`, tolerating at most
    // ONE minor unit of the order's own currency) already guarantees this can
    // only ever be floating-point/rounding dust, never a real declared surcharge -
    // there is no legitimate order shape that reaches this adapter with lines
    // summing to LESS than the total. Recording a fictitious "markup" on a
    // fiscal document to paper over rounding noise is worse than refusing.
    throw new EparagonyConfigException(
      `eparagony.pl cannot register order ${command.orderId}: lines sum to less than the ` +
        `gross total by ${balancing} minor unit(s); refusing to record it as a fabricated markup`,
      'The order lines do not add up to the order total, so no e-receipt was requested.',
    );
  }

  const paymentForm = config.paymentForm ?? DEFAULT_PAYMENT_FORM;
  const request: EparagonyCreateReceiptRequest = {
    posId: config.posId,
    documentToken,
    transactionToken,
    eReceipt: {
      // Always true: registering the sale IS the point of this capability. A
      // document created without it would be a non-fiscal courtesy copy.
      fiscalize: true,
      print: config.print === true,
      metadata: {
        grossSaleValue,
        taxRates: table,
        // Carried so the vendor (and a later human) can tie the document back to
        // the order. `locateByQuery` cannot search on it - the vendor exposes no
        // such query - but it is the field an operator reads on a support call.
        orderId: command.orderId,
        merchantDocumentId: command.orderId,
      },
      lines,
      payment: {
        payments: [
          {
            paymentForm: EPARAGONY_PAYMENT_FORM_WIRE[paymentForm] ?? paymentForm,
            ...(config.paymentName === undefined ? {} : { paymentName: config.paymentName }),
            paidThisForm: grossSaleValue,
          },
        ],
        totalPaid: grossSaleValue,
      },
    },
  };

  if (command.occurredAt instanceof Date && !Number.isNaN(command.occurredAt.getTime())) {
    request.eReceipt.metadata.orderTime = command.occurredAt.toISOString();
  }
  if (/^[A-Z]{3}$/.test(command.currency)) {
    request.eReceipt.metadata.currency = command.currency;
  }

  return request;
}

function toProductLine(
  line: FiscalTransactionLine,
  table: EparagonyTaxRateTable,
  config: EparagonyConnectionConfig,
  orderId: string,
): EparagonyReceiptProductLine {
  const taxRate = resolveTaxRateCode(line.taxRate, table, config.defaultTaxRateCode);
  if (taxRate === null) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot register order ${orderId}: line "${line.name}" carries tax rate ` +
        `"${line.taxRate}", which matches no configured device rate`,
      line.taxRate.trim().length === 0
        ? 'No tax rate is available for at least one order line, and this connection declares no default rate. Set a default rate on the connection or supply per-line rates.'
        : 'At least one order line carries a tax rate that matches none of the rates configured on this connection.',
    );
  }

  const quantity = toQuantityString(line.quantity);
  if (quantity === null) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot register order ${orderId}: line "${line.name}" has a non-registrable quantity ${line.quantity}`,
      'At least one order line has a quantity that cannot be registered.',
    );
  }

  const unitPrice = toMinorUnits(line.unitPriceGross);
  if (unitPrice === null) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot register order ${orderId}: line "${line.name}" has a non-registrable unit price`,
      'At least one order line has a price that cannot be registered.',
    );
  }

  const totalLineValue = toMinorUnits(line.unitPriceGross * line.quantity);
  if (totalLineValue === null) {
    throw new EparagonyConfigException(
      `eparagony.pl cannot register order ${orderId}: line "${line.name}" has a non-registrable line total`,
      'At least one order line has a total that cannot be registered.',
    );
  }

  const product: EparagonyReceiptProductLine = {
    type: 'PRODUCT',
    productOrServiceName: line.name,
    quantity,
    unitPrice,
    totalLineValue,
    taxRate,
  };
  // `line.sku` is declared `string | null` (never optional), but a value
  // crossing a serialization boundary (a queued job payload, a hand-built
  // caller bypassing the type checker) can still arrive as `undefined` - a
  // `!== null` guard alone crashes on `.trim()` in that case. Checking for a
  // non-empty string directly is equally correct for the well-typed case and
  // additionally tolerant of the malformed one.
  if (typeof line.sku === 'string' && line.sku.trim().length > 0) {
    product.SKU = line.sku.trim();
  }
  return product;
}

// ---------------------------------------------------------------------------
// Status -> neutral result
// ---------------------------------------------------------------------------

/** Read the `status` discriminator without assuming it is one of the known values. */
export function readDocumentStatus(body: EparagonyDocumentStatusResponse): string | null {
  return typeof body.status === 'string' ? body.status.trim().toUpperCase() : null;
}

export function isConfirmed(body: EparagonyDocumentStatusResponse): boolean {
  return readDocumentStatus(body) === EPARAGONY_STATUS_CONFIRMED;
}

/**
 * Project a document status onto the neutral registration result.
 *
 * `documentToken` is passed in rather than read off the body: it is OUR
 * deterministic token, so it is authoritative even when a sparse response omits
 * the echo.
 */
export function toRegisterTransactionResult(
  body: EparagonyDocumentStatusResponse,
  documentToken: string,
): RegisterTransactionResult {
  return {
    providerType: EPARAGONY_PROVIDER_TYPE,
    // What a later lookup is keyed on - the vendor's only document key.
    providerReference: documentToken,
    documentReference: readDocumentReference(body),
    // PL: numer unikatowy of the device that signed the registration. Flat by
    // design (ADR-042 decision 3) - core never learns what class of anchor it is.
    signingIdentity: readString(body.fiscalDeviceUniqueNumber),
    // Prefer `null` over fabricating OL's own clock as a provider-reported
    // timestamp (I7): `toLocateResult` below already returns `null` in the
    // same case, and this field is part of the persisted identity set.
    registeredAt: readDate(body.endTime),
    regimeExtras: toRegimeExtras(body),
    artefacts: toArtefacts(body),
  };
}

/** Project a document status onto the neutral locate result. */
export function toLocateResult(
  body: EparagonyDocumentStatusResponse,
  documentToken: string,
): FiscalLocateResult {
  return {
    providerReference: documentToken,
    documentReference: readDocumentReference(body),
    signingIdentity: readString(body.fiscalDeviceUniqueNumber),
    registeredAt: readDate(body.endTime),
    regimeExtras: toRegimeExtras(body),
    artefacts: toArtefacts(body),
  };
}

/**
 * The buyer-facing link, and ONLY once the registration is confirmed.
 *
 * The vendor states plainly that the link should not be handed out before
 * `CONFIRMED`, and the earlier statuses do carry a `documentUrl` - so gating on
 * the status rather than on the field's presence is the whole point. An
 * artefact-less result is still a successful registration (ADR-042 decision 2).
 */
function toArtefacts(body: EparagonyDocumentStatusResponse): FiscalArtefact[] {
  if (!isConfirmed(body)) {
    return [];
  }
  const url = readString(body.documentUrl);
  if (url === null) {
    return [];
  }
  return [
    {
      medium: 'link',
      // A hint, never an instruction: core neither renders nor delivers.
      disposition: 'send',
      content: url,
      contentType: null,
      label: RECEIPT_LINK_LABEL,
    },
  ];
}

/**
 * The reference borne by the registered document itself (PL: numer paragonu).
 * Prefers the device's receipt counter, falling back to its document counter -
 * the vendor marks the former optional and the latter required.
 */
function readDocumentReference(body: EparagonyDocumentStatusResponse): string | null {
  return readString(body.receiptNumber) ?? readString(body.fiscalDocumentNumber);
}

/**
 * Everything with no cross-regime counterpart, as flat strings. Core persists
 * the bag verbatim and indexes no key inside it (ADR-042 decision 9).
 */
function toRegimeExtras(body: EparagonyDocumentStatusResponse): Record<string, string> {
  const extras: Record<string, string> = {};
  const candidates: Array<[string, unknown]> = [
    ['fiscalDocumentId', body.fiscalDocumentId],
    ['fiscalDocumentNumber', body.fiscalDocumentNumber],
    ['receiptNumber', body.receiptNumber],
    ['transactionToken', body.transactionToken],
    ['documentType', body.documentType],
    ['processingMode', body.processingMode],
    ['posId', body.posId],
    ['merchantStoreId', body.merchantStoreId],
    ['merchantDocumentId', body.merchantDocumentId],
    ['printed', body.printed],
  ];
  for (const [key, value] of candidates) {
    const text = readString(value);
    if (text !== null) {
      extras[key] = text;
    }
  }
  return extras;
}

/**
 * Coerce a scalar to a non-empty string, or `null`. Numbers and booleans are
 * accepted because the vendor types some counters as numbers and `printed` as a
 * boolean; objects and arrays are refused so a shape change cannot smuggle
 * `[object Object]` onto a fiscal identity field.
 */
function readString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
