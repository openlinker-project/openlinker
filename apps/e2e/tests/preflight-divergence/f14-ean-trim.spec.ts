/**
 * F14 - the frontend trims the EAN, the backend does not
 *
 * ⚠️ CHARACTERIZATION TEST. It passes while the divergence exists and FAILS the
 * moment the finding is closed (or was wrong in the first place). A red run here
 * is a signal to re-read the finding, not a regression in the product.
 *
 * DEPENDS ON F13 (`f13-blocked-not-excluded.spec.ts`). The claimed divergence is:
 *
 *   (a) What the wizard presents - `effectiveVariantEan` (`bulk-policy.ts`) does
 *       `raw.trim()`, so " 5901234123457" is read as a valid GTIN-13 and the row
 *       renders `ready`.
 *   (b) What actually happens - `BulkListingSubmitService.enforceIdentifierRules`
 *       reads `variant?.ean` LITERALLY. With the leading space the string is 14
 *       characters, hits `GTIN_LENGTHS.has(14)`, fails `isValidGs1CheckDigit`
 *       (which rejects anything non-numeric outright) and throws
 *       `InvalidEanException` → 400 on the WHOLE request, not just that row.
 *
 * It is normally masked because the wizard sends the already-trimmed value as
 * `overrides.ean`. It only surfaces for a variant that has NO per-variant
 * override - which is exactly the state F13 creates.
 *
 * VERDICT ON THE LIVE STACK: the divergence is real at the line level but its
 * precondition is UNREACHABLE. A master variant's `ean` cannot carry whitespace,
 * because `MasterProductSyncService` normalises every ingested barcode through
 * `normalizeToEan13` → `normalizeBarcode`, which does `input.trim()
 * .replace(/\D/g, '')` and returns null for any length that is not 12/13. So the
 * stored value is always exactly 13 digits or null. Test 1 pins that invariant:
 * the day it is relaxed (a new master adapter writing raw barcodes, a direct
 * write path, a widened normaliser) this test goes red and F14 becomes live.
 *
 * Test 2 pins the other half: the OVERRIDE channel - the one the wizard actually
 * uses - is guarded, but by the DTO regex, not by the identifier gate. Which is
 * the whole point: two independently-written validators, only one of them on the
 * path F13 opens up.
 *
 * @module tests/preflight-divergence
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Product, ProductVariant } from '../../src/api/api.types';
import type { E2eEnv } from '../../src/config/env';

/** Per-variant / per-product override entry of `POST /listings/bulk-create`. */
interface BulkOverride {
  stock?: number;
  publishImmediately?: boolean;
  price?: { amount: number; currency: string };
  overrides?: Record<string, unknown>;
}

/** Request body of `POST /listings/bulk-create` (mirrored locally, #1741 shape). */
interface BulkCreateBody {
  connectionId: string;
  productIds: string[];
  sharedConfig: { stock: number; publishImmediately: boolean };
  perVariantOverrides?: Record<string, BulkOverride>;
  excludedVariantIds?: string[];
}

/** A valid GTIN-13 (check digit verified below), with a leading space bolted on. */
const VALID_GTIN13 = '5901234123457';
const UNTRIMMED_EAN = ` ${VALID_GTIN13}`;

test.describe('F14 - EAN trimming asymmetry between wizard and submit service', () => {
  test('the wizard-side trim has no backend counterpart, but no stored master EAN can exercise it', async ({
    world,
  }) => {
    // The FE treats " 5901234123457" as a valid GTIN-13 - assert the premise
    // rather than trusting it. This mirrors `isValidGtin` / `isValidGs1CheckDigit`
    // verbatim; both sides of the divergence run the same GS1 arithmetic, they
    // just disagree about whitespace.
    expect(isValidGs1CheckDigit(VALID_GTIN13), `${VALID_GTIN13} is a valid GTIN-13`).toBe(true);
    expect(
      isValidGs1CheckDigit(UNTRIMMED_EAN.trim()),
      'the FE trims first, so it sees a valid GTIN-13',
    ).toBe(true);
    expect(
      isValidGs1CheckDigit(UNTRIMMED_EAN),
      'the BE does NOT trim, so it sees a non-numeric 14-char string and rejects it - ' +
        'this asymmetry is F14',
    ).toBe(false);
    expect(
      UNTRIMMED_EAN.length,
      'the untrimmed string is 14 chars long, i.e. inside GTIN_LENGTHS - which is why the ' +
        'backend runs the check-digit test on it at all instead of skipping it',
    ).toBe(14);

    // The precondition F14 needs: a master variant whose stored `ean`/`gtin`
    // carries whitespace. Assert it cannot exist on this stack - every ingested
    // barcode passes through `normalizeToEan13` / `normalizeBarcode`.
    const offenders: string[] = [];
    let inspected = 0;
    for (const product of await world.listProducts(100)) {
      for (const variant of await world.variantsOf(product.id)) {
        for (const [field, value] of [
          ['ean', variant.ean],
          ['gtin', variant.gtin],
        ] as const) {
          if (value === null || value === undefined) continue;
          inspected += 1;
          if (!/^\d+$/.test(value)) {
            offenders.push(`${variant.id}.${field}=${JSON.stringify(value)}`);
          }
        }
      }
    }
    expect(inspected, 'the stack exposes at least one barcoded master variant to inspect')
      .toBeGreaterThan(0);
    expect(
      offenders,
      'no master variant carries a non-digit (e.g. whitespace-padded) barcode: ' +
        '`MasterProductSyncService` normalises on ingest, so the state F14 needs is ' +
        'unreachable through the master-sync path. If this list is ever non-empty, F14 is live ' +
        'and a single such product 400s the entire bulk submit it appears in.',
    ).toEqual([]);
  });

  test('the OVERRIDE channel is guarded - by the DTO regex, not by the identifier gate', async ({
    api,
    world,
    env,
  }) => {
    const allegro = world.connectionFor('allegro');
    test.skip(allegro === undefined, 'F14 needs an Allegro connection as the wizard destination.');
    const connection = allegro!;

    const variant = await findFreeVariant(api, world, connection.id);
    test.skip(
      variant === null,
      'F14 needs one master variant with no Allegro offer mapping (mapped variants are ' +
        'dropped by `filterAlreadyListed` before the identifier gate runs).',
    );

    const result = await submitBulkCreate(env, {
      connectionId: connection.id,
      productIds: [variant!.id],
      sharedConfig: { stock: 1, publishImmediately: false },
      perVariantOverrides: { [variant!.id]: { overrides: { ean: UNTRIMMED_EAN } } },
      excludedVariantIds: [],
    });

    // Both halves of the assertion matter. It IS rejected (so the override path
    // an operator can actually reach is safe) …
    expect(
      result.status,
      `an untrimmed override EAN is rejected: ${JSON.stringify(result.body)}`,
    ).toBe(400);
    const message = messageOf(result.body);
    // … but by `CreateOfferOverridesDto.@Matches(/^(\d{8}|\d{12,14})$/)` running
    // under `@ValidateRecordValues`, i.e. a validator that exists ONLY on the
    // override branch - and one that flattens the nested failure into an opaque
    // "invalid value" naming neither the field nor the reason. The master-variant
    // branch has no such pre-filter at all: it reaches `enforceIdentifierRules`,
    // whose rejection would name the variant and the EAN.
    expect(
      message,
      'rejected by the record-value DTO validator on the override branch, which reports the ' +
        'whole override object as "invalid value" without ever naming `ean` - opaque, but ' +
        'present. The master-EAN path F13 exposes has no equivalent pre-filter.',
    ).toMatch(/perVariantOverrides\[.+\]\.overrides: invalid value/i);
    expect(
      message,
      'the identifier gate (InvalidEanException) never got to run: the DTO short-circuited ' +
        'first, which is why the untrimmed-master-EAN path is untested by construction',
    ).not.toMatch(/check digit|invalid ean/i);
  });

  test('the divergence itself (InvalidEanException from an untrimmed MASTER ean) is unprovisionable', async () => {
    test.skip(
      true,
      'BLOCKED ON FIXTURE. Reproducing F14 end-to-end needs a master ProductVariant whose ' +
        'persisted `ean` starts with whitespace (e.g. " 5901234123457"), plus the F13 state ' +
        '(that variant included-but-blocked, so the wizard sends no `overrides.ean` for it). ' +
        'Neither the PrestaShop nor the WooCommerce master path can produce it: ' +
        '`MasterProductSyncService.toVariant` normalises `ean` via `normalizeToEan13` and ' +
        '`gtin` via `normalizeBarcode`, both of which trim and strip non-digits before the ' +
        'row is written. The only remaining routes are a direct DB write (forbidden on this ' +
        'shared demo stack) or a new master adapter bypassing the normaliser. Test 1 above ' +
        'pins the normalisation invariant so this becomes reachable - and goes red - the day ' +
        'it is relaxed.',
    );
  });
});

/** First master variant with a barcode and no offer mapping on `connectionId`. */
async function findFreeVariant(
  api: ApiClient,
  world: {
    listProducts(limit?: number): Promise<Product[]>;
    variantsOf(id: string): Promise<ProductVariant[]>;
  },
  connectionId: string,
): Promise<ProductVariant | null> {
  const mapped = await mappedVariantIds(api, connectionId);
  for (const product of await world.listProducts(100)) {
    const variants = await world.variantsOf(product.id);
    // A single-variant product keeps the fan-out to exactly one job, so the
    // rejection can only come from the variant under test.
    if (variants.length !== 1) continue;
    const [variant] = variants;
    if (!mapped.has(variant.id)) return variant;
  }
  return null;
}

async function mappedVariantIds(api: ApiClient, connectionId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    const page = await api.listings.list({ connectionId, limit: 100, offset });
    page.items.forEach((mapping) => ids.add(mapping.internalId));
    if (page.items.length === 0 || offset + 100 >= page.total) break;
  }
  return ids;
}

/**
 * GS1 mod-10 check digit, transcribed from `isValidGs1CheckDigit`
 * (`bulk-listing-submit.service.ts`) - including its `/^\d+$/` guard, which is
 * the exact line the untrimmed value trips over.
 */
function isValidGs1CheckDigit(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  const digits = [...code].map((c) => Number(c));
  const check = digits[digits.length - 1];
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = body.length - 1, pos = 0; i >= 0; i--, pos++) {
    sum += body[i] * (pos % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

function messageOf(body: unknown): string {
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  return JSON.stringify(body);
}

/**
 * Raw `POST /listings/bulk-create`. The node `ApiClient` exposes no bulk-submit
 * method and this suite must not modify `src/`, so the call is issued directly
 * here. Returns status + parsed body rather than throwing.
 */
async function submitBulkCreate(
  env: E2eEnv,
  body: BulkCreateBody,
): Promise<{ status: number; body: unknown }> {
  const token = await loginForRawCalls(env);
  const response = await fetch(`${env.apiUrl}/v1/listings/bulk-create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'x-idempotency-key': randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let parsed: unknown = raw;
  try {
    parsed = raw.length > 0 ? JSON.parse(raw) : undefined;
  } catch {
    /* non-JSON body - keep the raw text */
  }
  return { status: response.status, body: parsed };
}

async function loginForRawCalls(env: E2eEnv): Promise<string> {
  const response = await fetch(`${env.apiUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env.adminUser, password: env.adminPass }),
  });
  if (!response.ok) {
    throw new Error(`Login failed: HTTP ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { access_token: string }).access_token;
}
