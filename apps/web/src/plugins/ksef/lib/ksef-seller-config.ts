/**
 * KSeF Seller-Profile Assembly
 *
 * Single source of truth for assembling the nested `config.seller` shape the
 * KSeF adapter's `resolveSeller` reads (`{ nip, name, address: { line1, line2?,
 * city, postalCode, countryIso2 } }`, #1223). Both the create path
 * (`ksef-setup.schema.ts`) and the edit path (`ksef-connection-config.ts`)
 * consume this module so the persisted shape — and the per-leaf normalization
 * rules (NIP digits-only, name/address trim, country uppercase) — cannot drift
 * between the two flows.
 *
 * `applyKsefSellerToConfig` is the one assembly primitive: it touches only the
 * seller leaves present on the patch (so the edit path's per-field sync preserves
 * untouched siblings) and drops an emptied `address` / `seller` object so a
 * hollow profile is never persisted. `buildKsefSellerConfig` is the create-path
 * convenience wrapper that assembles a fresh profile from scratch by applying a
 * full input onto an empty config.
 *
 * NIP is the canonical `config.seller.nip` location — there is no flat
 * `config.sellerNip`.
 *
 * @module plugins/ksef/lib
 */
import { normalizeNip } from './ksef-nip';

/**
 * Flat seller-profile sub-fields collected by the wizard. Shared between the
 * create path (`ksef-setup.schema.ts`) and the edit path
 * (`ksef-connection-config.ts`) so both flows assemble the identical nested
 * `config.seller` shape.
 */
export interface KsefSellerProfileInput {
  sellerNip?: string;
  sellerName?: string;
  sellerAddressLine1?: string;
  sellerAddressLine2?: string;
  sellerCity?: string;
  sellerPostalCode?: string;
  sellerCountryIso2?: string;
}

/** Normalize a NIP to digits only (strip the dashes/spaces an operator pastes). */
function normalizeSellerNip(value: string): string {
  return normalizeNip(value);
}

/** Trim a free-text leaf (name, address line, city, postal code). */
function normalizeTextLeaf(value: string): string {
  return value.trim();
}

/** Trim + upper-case an ISO 3166-1 alpha-2 country code. */
function normalizeCountryIso2(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Whether any seller sub-field is present on the patch. Used by the edit path to
 * skip the seller branch entirely when a non-seller field (e.g. environment) is
 * the only thing changing.
 */
export function patchTouchesSeller(input: KsefSellerProfileInput): boolean {
  return (
    input.sellerNip !== undefined ||
    input.sellerName !== undefined ||
    input.sellerAddressLine1 !== undefined ||
    input.sellerAddressLine2 !== undefined ||
    input.sellerCity !== undefined ||
    input.sellerPostalCode !== undefined ||
    input.sellerCountryIso2 !== undefined
  );
}

function setOrDeleteLeaf(
  target: Record<string, unknown>,
  key: string,
  normalized: string,
): void {
  if (normalized.length === 0) delete target[key];
  else target[key] = normalized;
}

/**
 * Apply seller sub-field patches onto an existing `config` object, returning a
 * new config. Only sub-fields present on the patch are touched; siblings are
 * preserved. An emptied leaf is deleted, and an emptied `address` / `seller`
 * object is dropped so a hollow profile is never persisted.
 *
 * The create path applies a full input onto `{}`; the edit path applies a
 * per-field patch onto the live config — both run through the identical
 * normalization here.
 */
export function applyKsefSellerToConfig(
  base: Record<string, unknown>,
  input: KsefSellerProfileInput,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  if (!patchTouchesSeller(input)) return next;

  const seller: Record<string, unknown> =
    typeof next.seller === 'object' && next.seller !== null
      ? { ...(next.seller as Record<string, unknown>) }
      : {};
  const address: Record<string, unknown> =
    typeof seller.address === 'object' && seller.address !== null
      ? { ...(seller.address as Record<string, unknown>) }
      : {};

  if (input.sellerNip !== undefined) {
    setOrDeleteLeaf(seller, 'nip', normalizeSellerNip(input.sellerNip));
  }
  if (input.sellerName !== undefined) {
    setOrDeleteLeaf(seller, 'name', normalizeTextLeaf(input.sellerName));
  }
  if (input.sellerAddressLine1 !== undefined) {
    setOrDeleteLeaf(address, 'line1', normalizeTextLeaf(input.sellerAddressLine1));
  }
  if (input.sellerAddressLine2 !== undefined) {
    setOrDeleteLeaf(address, 'line2', normalizeTextLeaf(input.sellerAddressLine2));
  }
  if (input.sellerCity !== undefined) {
    setOrDeleteLeaf(address, 'city', normalizeTextLeaf(input.sellerCity));
  }
  if (input.sellerPostalCode !== undefined) {
    setOrDeleteLeaf(address, 'postalCode', normalizeTextLeaf(input.sellerPostalCode));
  }
  if (input.sellerCountryIso2 !== undefined) {
    setOrDeleteLeaf(address, 'countryIso2', normalizeCountryIso2(input.sellerCountryIso2));
  }

  if (Object.keys(address).length === 0) delete seller.address;
  else seller.address = address;

  if (isHollowSeller(seller)) delete next.seller;
  else next.seller = seller;

  return next;
}

/**
 * A seller whose only content is an address carrying a lone `countryIso2` is
 * hollow — it carries no real profile, just the PL country default the create
 * wizard seeds. Treat it as empty so a `seller: { address: { countryIso2 } }`
 * shell isn't persisted (#1223 review). Anything beyond that lone leaf (a NIP, a
 * name, a second address field) makes the profile real.
 */
function isHollowSeller(seller: Record<string, unknown>): boolean {
  const sellerKeys = Object.keys(seller);
  if (sellerKeys.length === 0) return true;
  if (sellerKeys.length !== 1 || sellerKeys[0] !== 'address') return false;
  const address = seller.address as Record<string, unknown>;
  const addressKeys = Object.keys(address);
  return addressKeys.length === 1 && addressKeys[0] === 'countryIso2';
}

/**
 * Assemble the nested `config.seller` object from a full seller input, returning
 * `undefined` when no seller sub-field is supplied so an empty profile doesn't
 * write a hollow `seller` key. Convenience wrapper over
 * `applyKsefSellerToConfig` — the single assembly primitive both create and edit
 * share.
 */
export function buildKsefSellerConfig(
  input: KsefSellerProfileInput,
): Record<string, unknown> | undefined {
  const assembled = applyKsefSellerToConfig({}, input);
  return assembled.seller as Record<string, unknown> | undefined;
}
