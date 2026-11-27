/**
 * ksef-legal: NIP handling (DEF-11 / DEF-12 / DEF-19 / DEF-28)
 *
 * - A buyer or seller NIP typed with separators reaches FA(3) as digits only
 *   (`TNrNIP` refuses anything else), on both Podmiot2 and Podmiot1.
 * - A NIP whose mod-11 check digit is wrong is refused before KSeF: that is
 *   arithmetic, not an interpretation.
 * - A NIP that passes the checksum but looks implausible (`0000000000`) only
 *   warns, because OpenLinker may be wrong about what MF accepts.
 * - A connection whose STORED NIP fails today's check can still be saved when
 *   the NIP is not what changed.
 *
 * The seller-side cases change the live connection's config and restore it in
 * a `finally`, so a failed assertion cannot leave the stack issuing under a
 * different NIP.
 *
 * @module tests/ksef-legal
 */
import pg from 'pg';
import { test, expect } from '../../src/fixtures/test';
import { shot } from '../../src/support/shot';
import {
  BUYER_NIP,
  BUYER_NIP_DASHED,
  elementTexts,
  failureOf,
  issueAndClear,
  requireKsef,
  ksefOrder,
} from './ksef-legal.helpers';

function sellerNipOf(config: Record<string, unknown> | null): string {
  const seller = (config?.['seller'] ?? {}) as { nip?: string };
  return seller.nip ?? '';
}

function withSellerNip(config: Record<string, unknown>, nip: string): Record<string, unknown> {
  const seller = { ...((config['seller'] ?? {}) as Record<string, unknown>), nip };
  return { ...config, seller };
}

test.describe('ksef-legal: NIP handling', () => {
  test('separators are stripped from the buyer and seller NIP before FA(3)', async ({
    api,
    world,
    jobs,
    poll,
  }, testInfo) => {
    const ksef = requireKsef(world);
    const original = (await api.connections.getById(ksef.id)).config ?? {};
    const sellerDigits = sellerNipOf(original).replace(/\D/g, '');
    test.skip(sellerDigits.length !== 10, 'the KSeF connection carries no 10-digit seller NIP');
    const sellerDashed = `${sellerDigits.slice(0, 3)}-${sellerDigits.slice(3, 6)}-${sellerDigits.slice(6, 8)}-${sellerDigits.slice(8)}`;

    try {
      const saved = await api.connections.update(ksef.id, {
        config: withSellerNip(original, sellerDashed),
      });
      testInfo.annotations.push({
        type: 'seller-nip-saved-as',
        description: sellerNipOf(saved.config),
      });

      const synthesized = await ksefOrder({ api, world, jobs, poll });
      const accepted = await issueAndClear(
        { api, jobs, poll },
        ksef,
        synthesized.order.internalOrderId,
        {
          buyerTaxId: { scheme: 'pl-nip', value: BUYER_NIP_DASHED },
        }
      );
      expect(
        accepted.regulatoryStatus,
        'KSeF TEST accepts a document built from dashed input'
      ).toBe('accepted');

      const xml = (await api.invoices.getSourceDocumentText(accepted.id)).text;
      const nips = elementTexts(xml, 'NIP');
      expect(nips, 'seller NIP in Podmiot1, digits only').toContain(sellerDigits);
      expect(nips, 'buyer NIP in Podmiot2, digits only').toContain(BUYER_NIP);
      expect(
        nips.every((n) => /^\d{10}$/.test(n)),
        `every NIP is ten digits: ${nips.join(', ')}`
      ).toBe(true);
    } finally {
      await api.connections.update(ksef.id, { config: original });
    }
  });

  test('a NIP with a wrong check digit is refused before anything reaches KSeF', async ({
    api,
    world,
    jobs,
    poll,
  }) => {
    const ksef = requireKsef(world);
    const synthesized = await ksefOrder({ api, world, jobs, poll });
    const refusal = await failureOf(
      api.invoices.issue({
        connectionId: ksef.id,
        orderId: synthesized.order.internalOrderId,
        buyerTaxId: { scheme: 'pl-nip', value: '1234567890' },
      })
    );
    expect(refusal?.status).toBe(400);
  });

  test('an implausible but checksum-valid seller NIP warns in the form, and nothing is saved', async ({
    api,
    world,
    page,
  }, testInfo) => {
    const ksef = requireKsef(world);
    const before = await api.connections.getById(ksef.id);
    await page.goto(`/connections/${ksef.id}/edit`);
    const nipField = page.getByLabel(/Seller NIP/i).first();
    await expect(nipField).toBeVisible();
    await nipField.fill('0000000000');
    await expect(page.getByText(/does not look like a typical NIP/)).toBeVisible();
    await shot(page, testInfo, 'nip/01-implausible-seller-nip-warning');
    // Leave without saving; the stored NIP must be untouched.
    await page.goto(`/connections/${ksef.id}`);
    const after = await api.connections.getById(ksef.id);
    expect(sellerNipOf(after.config)).toBe(sellerNipOf(before.config));
  });

  test("a stored NIP that fails today's check does not block saving an unrelated setting", async ({
    api,
    world,
  }) => {
    const ksef = requireKsef(world);
    const databaseUrl = process.env.E2E_DATABASE_URL?.trim();
    test.skip(
      !databaseUrl,
      'E2E_DATABASE_URL is required to plant a legacy NIP the API would refuse'
    );
    const original = (await api.connections.getById(ksef.id)).config ?? {};
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(
        `update connections set config = jsonb_set(config, '{seller,nip}', '"1234567890"') where id = $1`,
        [ksef.id]
      );
      const planted = (await api.connections.getById(ksef.id)).config ?? {};
      const invoiceDefaults = {
        ...((planted['invoiceDefaults'] ?? {}) as Record<string, unknown>),
        lineUnit: 'kpl.',
      };
      const saved = await api.connections.update(ksef.id, {
        config: { ...planted, invoiceDefaults },
      });
      expect((saved.config?.['invoiceDefaults'] as { lineUnit?: string }).lineUnit).toBe('kpl.');
    } finally {
      await client.query(`update connections set config = $2::jsonb where id = $1`, [
        ksef.id,
        JSON.stringify(original),
      ]);
      await client.end();
    }
  });
});
