/**
 * Fiscal Device Error Policy
 *
 * Turns eparagony.pl's terminal `ERROR` status into what an operator may see
 * (#3843): a sentence for the vendor code, the printer's own code, and an
 * explanation for a printer answer this module recognises exactly. Everything
 * returned is composed from fixed text and digits.
 *
 * The source is the vendor's public OpenAPI v3 (`FiscalDocumentStatusErrorPayload`,
 * docs.eparagony.pl). It documents ONE `errorCode` for a failed receipt - 83, a
 * communication error with the fiscal device - and lists its causes. The
 * `errorDescription` beside it is a printer message documented only by example
 * and per printer model (Novitus 16 and 18, Posnet 2106, 99 when the cause is
 * unknown), so the same number can mean different things on two printers. That
 * is why:
 *
 *   - the printer code is carried as DIGITS ONLY, read with a pattern anchored
 *     at the start of the description, and never explained on its own;
 *   - an explanation is given only when the WHOLE description matches a
 *     documented example exactly (after folding case, diacritics and
 *     whitespace), and the explanation is OpenLinker's own English sentence,
 *     never the vendor's words;
 *   - the description text itself never leaves this module. Our own adapter
 *     treats it as able to echo a product name, so it stays in the log.
 *
 * @module libs/integrations/eparagony/src/domain/policies
 */

/**
 * Vendor codes with a documented meaning for a failed receipt. A code missing
 * here keeps the generic sentence; it is still shown to the operator as a
 * structured code, so it is never appended to the sentence as well.
 */
const TERMINAL_ERROR_REASONS: Readonly<Record<number, string>> = {
  83: 'The fiscal printer could not register the sale. Usual causes: the printer is not fiscalized, it refused a product name, or e-receipts are switched off on it. Fix the cause, then register again.',
};

/** The sentence for a terminal `ERROR` whose code has no documented meaning. */
export const GENERIC_TERMINAL_ERROR_REASON =
  'The fiscal device reported an error and did not register the sale. Check the device, then register again under a new key.';

/**
 * Documented printer answers, folded (see {@link foldDescription}), mapped to
 * OpenLinker's explanation. `Kod bledu drukarki: 99` is deliberately absent:
 * the vendor uses it when it could not identify the cause, so there is nothing
 * to explain.
 */
const KNOWN_DEVICE_ERRORS: ReadonlyMap<string, string> = new Map([
  [
    'kod bledu drukarki: 16 - bledna nazwa towaru, prawdopodobnie brak znakow w kodowaniu windows-1250, rozwaz transliteracje',
    'The printer refused a product name, probably because of a character it cannot print. Remove or replace special characters in the name.',
  ],
  [
    'kod bledu drukarki: 18 - wystapil schodek podatkowy, sprawdz poprawnosc stawki vat i/lub zmien nazwe towaru',
    "The printer refused a product's VAT rate or name. Check the product's VAT rate, or change its name.",
  ],
  [
    'kod bledu drukarki: 2106 - wystapil schodek podatkowy, sprawdz poprawnosc stawki vat i/lub zmien nazwe towaru',
    "The printer refused a product's VAT rate or name. Check the product's VAT rate, or change its name.",
  ],
]);

/** `Kod błędu drukarki: <digits>` at the very start, with or without Polish letters. */
const DEVICE_CODE_PATTERN = /^\s*kod\s+b(?:l|ł)(?:e|ę)du\s+drukarki\s*:\s*(\d{1,10})(?!\d)/i;

export interface FiscalDeviceErrorReading {
  /** Operator sentence for the vendor code. */
  reason: string;
  /** The printer's code, digits only, or `null` when the description carries none. */
  deviceErrorCode: string | null;
  /** OpenLinker's explanation for an exactly-recognised printer answer, else `null`. */
  hint: string | null;
}

function foldDescription(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read a terminal `ERROR` status into its operator-safe parts. */
export function readFiscalDeviceError(
  errorCode: number | null,
  errorDescription: unknown,
): FiscalDeviceErrorReading {
  const reason =
    (errorCode !== null ? TERMINAL_ERROR_REASONS[errorCode] : undefined) ??
    GENERIC_TERMINAL_ERROR_REASON;
  if (typeof errorDescription !== 'string') {
    return { reason, deviceErrorCode: null, hint: null };
  }
  const match = DEVICE_CODE_PATTERN.exec(errorDescription);
  return {
    reason,
    deviceErrorCode: match ? match[1] : null,
    hint: KNOWN_DEVICE_ERRORS.get(foldDescription(errorDescription)) ?? null,
  };
}
