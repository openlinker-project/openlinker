/**
 * Mirakl Card Policy
 *
 * Pure rules for a catalogue card OpenLinker creates through P41 (#4278,
 * part 2): which attributes OpenLinker fills itself, how the offer command
 * becomes one card line, what must be there before the line is sent, and the
 * file the lines go out in.
 *
 * - **Filled from the command, never typed in:** category, the seller's
 *   product code, title, description, EAN, images, VAT, variant group, and the
 *   set / multipack attributes. They are hidden from the wizard's parameter
 *   list (`isMiraklCardAttributeFilledByOpenLinker`), so the operator does not
 *   enter the same thing twice.
 * - **Everything else comes from the offer's parameters**, the operator's or an
 *   attribute mapping rule's. A LIST value is sent as the list's code; a value
 *   the list does not contain refuses the card here rather than in the
 *   operator's review.
 * - **A required attribute left empty refuses the card**, naming it, so the
 *   operator fixes it before the file goes out (P41 runs at most every 15
 *   minutes and the operator reviews every card).
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import type {
  CategoryParameter,
  CreateOfferValidationError,
  OfferParameter,
  OfferProductSetComponent,
  OfferVariantGroup,
} from '@openlinker/core/listings';
import type { MiraklCardRow } from '../types/mirakl-card.types';
import type { MiraklCardAttributeCodes } from '../types/mirakl-operator-profile.types';
import { miraklCsvCell } from './mirakl-offer-file.policy';

/** Separator Mirakl reads between the values of a multi-value attribute. */
const MULTI_VALUE_SEPARATOR = '|';
/** Labels a yes/no LIST uses for "yes"; Empik's `650` reads `Y` / `Tak`. */
const YES_LABELS = new Set(['y', 'yes', 'tak', 'true', '1']);
/** OpenLinker's VAT exemption code and the label Polish operators give it. */
const EXEMPT_RATE_CODES = new Set(['zw']);
const EXEMPT_LABELS = new Set(['zwolniony', 'zw', 'exempt']);

export interface MiraklCardInput {
  readonly brand: string;
  readonly codes: MiraklCardAttributeCodes;
  /** The category's card attributes (PM11), unfiltered. */
  readonly attributes: readonly CategoryParameter[];
  readonly categoryId: string;
  readonly catalogCode: string;
  readonly ean: string;
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly imageUrls: readonly string[];
  readonly taxRate: string | undefined;
  readonly parameters: readonly OfferParameter[];
  readonly variantGroup?: OfferVariantGroup;
  readonly productSet?: readonly OfferProductSetComponent[];
}

export interface MiraklCardBuild {
  readonly row: MiraklCardRow;
  readonly errors: CreateOfferValidationError[];
}

/** The attributes OpenLinker fills itself; the wizard does not ask for them. */
export function isMiraklCardAttributeFilledByOpenLinker(
  code: string,
  codes: MiraklCardAttributeCodes
): boolean {
  if (code.startsWith(codes.extraImagePrefix)) {
    return true;
  }
  return [
    codes.category,
    codes.catalogCode,
    codes.title,
    codes.description,
    codes.ean,
    codes.mainImage,
    codes.vat,
    codes.variantGroup,
    codes.bundle,
    codes.bundleContents,
    codes.packQuantity,
  ].includes(code);
}

/** One P41 line for the command, and why it cannot be sent, if it cannot. */
export function buildMiraklCardRow(input: MiraklCardInput): MiraklCardBuild {
  const { codes } = input;
  const byCode = new Map(input.attributes.map((attribute) => [attribute.id, attribute]));
  const row: Record<string, string> = {};
  const errors: CreateOfferValidationError[] = [];
  const set = (code: string, value: string | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed) {
      row[code] = trimmed;
    }
  };

  set(codes.category, input.categoryId);
  set(codes.catalogCode, input.catalogCode);
  set(codes.ean, input.ean);
  set(codes.title, input.title);
  set(codes.description, input.description);
  const images = input.imageUrls.map((url) => url.trim()).filter((url) => url !== '');
  set(codes.mainImage, images[0]);
  images.slice(1, 1 + codes.extraImageCount).forEach((url, index) => {
    set(`${codes.extraImagePrefix}${index + 1}`, url);
  });

  const vat = byCode.get(codes.vat);
  if (vat && input.taxRate) {
    const id = vatDictionaryId(vat, input.taxRate);
    if (id) {
      row[codes.vat] = id;
    } else {
      errors.push({
        field: `parameters.${codes.vat}`,
        code: 'MIRAKL_CARD_VAT_UNKNOWN',
        message: `${input.brand} has no VAT rate matching ${input.taxRate} for "${vat.name}".`,
      });
    }
  }

  if (input.variantGroup && byCode.has(codes.variantGroup)) {
    set(codes.variantGroup, input.variantGroup.groupId);
  }
  applyProductSet(input, byCode, row);

  for (const parameter of input.parameters) {
    const attribute = byCode.get(parameter.id);
    if (!attribute || isMiraklCardAttributeFilledByOpenLinker(attribute.id, codes)) {
      continue;
    }
    const value = parameterValue(attribute, parameter);
    if (value.kind === 'value') {
      row[attribute.id] = value.value;
    } else if (value.kind === 'not-in-list') {
      errors.push({
        field: `parameters.${attribute.id}`,
        code: 'MIRAKL_CARD_VALUE_NOT_IN_LIST',
        message: `"${value.value}" is not one of the values ${input.brand} accepts for "${attribute.name}".`,
      });
    }
  }

  for (const attribute of input.attributes) {
    if (attribute.required && !row[attribute.id]) {
      errors.push({
        field: `parameters.${attribute.id}`,
        code: 'MIRAKL_CARD_ATTRIBUTE_REQUIRED',
        message: `${input.brand} needs "${attribute.name}" to create the product card.`,
      });
    }
  }
  return { row, errors };
}

/** The P41 file for several card lines: one column per attribute any line uses. */
export function buildMiraklCardFile(
  rows: readonly MiraklCardRow[],
  codes: MiraklCardAttributeCodes
): string {
  const columns = [codes.catalogCode];
  for (const row of rows) {
    for (const code of Object.keys(row)) {
      if (!columns.includes(code)) {
        columns.push(code);
      }
    }
  }
  const lines = rows.map((row) => columns.map((code) => miraklCsvCell(row[code] ?? '')).join(';'));
  return [columns.map(miraklCsvCell).join(';'), ...lines].join('\n') + '\n';
}

/**
 * The VAT list entry for an OpenLinker rate code (`23`, `8`, `0`, `zw`).
 * Matched on the label (`23%`), because the list's own codes are opaque.
 */
function vatDictionaryId(attribute: CategoryParameter, taxRate: string): string | undefined {
  const rate = taxRate.trim().toLowerCase();
  const entries = attribute.dictionary ?? [];
  if (EXEMPT_RATE_CODES.has(rate)) {
    return entries.find((entry) => EXEMPT_LABELS.has(entry.value.trim().toLowerCase()))?.id;
  }
  const numeric = Number(rate.replace(',', '.'));
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return entries.find((entry) => {
    const label = entry.value.trim().toLowerCase();
    // `0% techniczne` is a different rate from `0%`; only a bare percentage matches.
    const match = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(label);
    return match !== null && Number(match[1].replace(',', '.')) === numeric;
  })?.id;
}

/**
 * A set (several products) is its own card with the set attribute on; a
 * multipack (one product, N units) states N. Neither has a structural link to
 * the component cards on Mirakl, so the components' stock and orders stay
 * OpenLinker's (ADR-083).
 */
function applyProductSet(
  input: MiraklCardInput,
  byCode: ReadonlyMap<string, CategoryParameter>,
  row: Record<string, string>
): void {
  const components = input.productSet ?? [];
  if (components.length === 0) {
    return;
  }
  const { codes } = input;
  if (components.length === 1) {
    const quantity = components[0].quantity;
    if (quantity > 1 && byCode.has(codes.packQuantity)) {
      row[codes.packQuantity] = String(quantity);
    }
    return;
  }
  const bundle = byCode.get(codes.bundle);
  const yes = bundle?.dictionary?.find(
    (entry) =>
      YES_LABELS.has(entry.id.trim().toLowerCase()) ||
      YES_LABELS.has(entry.value.trim().toLowerCase())
  );
  if (yes) {
    row[codes.bundle] = yes.id;
  }
  if (byCode.has(codes.bundleContents)) {
    row[codes.bundleContents] = components
      .map((component) => `${component.quantity} x ${component.name}`)
      .join(', ');
  }
}

type ParameterValue =
  | { kind: 'value'; value: string }
  | { kind: 'empty' }
  | { kind: 'not-in-list'; value: string };

function parameterValue(attribute: CategoryParameter, parameter: OfferParameter): ParameterValue {
  if (attribute.type === 'dictionary' && (attribute.dictionary?.length ?? 0) > 0) {
    const dictionary = attribute.dictionary ?? [];
    const ids: string[] = [];
    for (const id of parameter.valuesIds ?? []) {
      if (!dictionary.some((entry) => entry.id === id)) {
        return { kind: 'not-in-list', value: id };
      }
      ids.push(id);
    }
    for (const raw of parameter.values ?? []) {
      const label = raw.trim().toLowerCase();
      if (label === '') continue;
      const entry = dictionary.find(
        (candidate) =>
          candidate.value.trim().toLowerCase() === label || candidate.id.toLowerCase() === label
      );
      if (!entry) {
        return { kind: 'not-in-list', value: raw };
      }
      if (!ids.includes(entry.id)) ids.push(entry.id);
    }
    return ids.length > 0
      ? { kind: 'value', value: ids.join(MULTI_VALUE_SEPARATOR) }
      : { kind: 'empty' };
  }
  const values = (parameter.values ?? [])
    .map((value) => value.trim())
    .filter((value) => value !== '');
  return values.length > 0
    ? { kind: 'value', value: values.join(MULTI_VALUE_SEPARATOR) }
    : { kind: 'empty' };
}
