/**
 * ksef-legal: KOD I verification code (DEF-02 / DEF-03 / DEF-15)
 *
 * The link is built on the server from the submitted document. This spec
 * checks it from the outside, the way MF would: the host matches the
 * connection's environment, the path carries the seller NIP and the issue
 * date, the hash is Base64URL(SHA-256) of the exact source XML bytes, and the
 * QR on screen - decoded from pixels, not from the app's own SVG - encodes
 * that same link.
 *
 * DEF-15 (the browser refusing to hash in an insecure context) no longer has
 * a surface: the browser does not hash at all now, so there is nothing to
 * assert beyond the server-built link.
 *
 * @module tests/ksef-legal
 */
import { createHash } from 'node:crypto';
import { test, expect } from '../../src/fixtures/test';
import { decodeQrFromLocator } from '../../src/support/decode-qr';
import { shot } from '../../src/support/shot';
import { elementTexts, issueAndClear, requireKsef, ksefOrder } from './ksef-legal.helpers';

const QR_HOST_BY_ENV: Record<string, string> = {
  test: 'qr-test.ksef.mf.gov.pl',
  demo: 'qr-demo.ksef.mf.gov.pl',
  prod: 'qr.ksef.mf.gov.pl',
};

test.describe('ksef-legal: KOD I verification code', () => {
  test('the link names the right host, NIP, date and hash, and the QR encodes it', async ({
    api,
    world,
    jobs,
    poll,
    pages,
    page,
  }, testInfo) => {
    const ksef = requireKsef(world);
    const env = String((ksef.config?.['env'] as string | undefined) ?? '');
    const expectedHost = QR_HOST_BY_ENV[env];
    test.skip(!expectedHost, `unknown KSeF environment "${env}"`);

    const synthesized = await ksefOrder({ api, world, jobs, poll });
    const accepted = await issueAndClear(
      { api, jobs, poll },
      ksef,
      synthesized.order.internalOrderId
    );
    expect(accepted.regulatoryStatus).toBe('accepted');

    const { url } = await api.invoices.verificationLink(accepted.id);
    expect(url, 'a cleared KSeF invoice has a verification link').not.toBeNull();
    const link = new URL(url!);
    expect(link.host).toBe(expectedHost);

    const source = await api.invoices.getSourceDocumentText(accepted.id);
    const xml = source.text;
    const [, , nip, ddmmyyyy, hash] = link.pathname.split('/');
    const sellerNip = elementTexts(xml, 'NIP')[0];
    expect(nip).toBe(sellerNip);
    const [p1] = elementTexts(xml, 'P_1');
    const [y, m, d] = p1.split('-');
    expect(ddmmyyyy).toBe(`${d}-${m}-${y}`);
    const expectedHash = createHash('sha256').update(Buffer.from(xml, 'utf8')).digest('base64url');
    expect(hash, 'Base64URL(SHA-256) of the exact source bytes').toBe(expectedHash);

    // The host answers (MF serves a page for the code); anything below 400.
    const probe = await fetch(url!, { redirect: 'manual' }).catch(() => null);
    testInfo.annotations.push({
      type: 'qr-probe-status',
      description: String(probe?.status ?? 'unreachable'),
    });
    if (probe) {
      expect(probe.status).toBeLessThan(400);
    }

    const detail = await pages.ordersList.open(synthesized.order.internalOrderId);
    await detail.invoice.openFa3Preview();
    await expect(detail.invoice.verificationQr).toBeVisible();
    await shot(page, testInfo, 'qr/01-fa3-preview-with-verification-qr');
    await shot(detail.invoice.panel, testInfo, 'qr/02-sales-document-panel');
    const decoded = await decodeQrFromLocator(detail.invoice.verificationQr);
    expect(decoded, 'the QR on screen decodes to the server-built link').toBe(url);
  });
});
