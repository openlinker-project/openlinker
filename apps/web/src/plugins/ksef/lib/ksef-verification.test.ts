/**
 * KSeF verification-code URL assembly tests (#1579)
 *
 * Locks the KOD I construction: host selection (prod vs test), the ISO ->
 * DD-MM-RRRR date reformat, Base64URL SHA-256 hashing of the exact XML bytes,
 * and the full URL shape. The hash fixture uses a fixed XML byte string with a
 * pre-computed expected digest so any change to the hashing/encoding is caught.
 *
 * @module plugins/ksef/lib
 */
import { describe, it, expect } from 'vitest';
import {
  bytesToBase64Url,
  buildKsefVerificationUrl,
  formatIssueDateForVerification,
  resolveKsefVerificationHost,
  sha256Base64Url,
} from './ksef-verification';

// SHA-256 of the UTF-8 bytes of this exact string, Base64URL-encoded (padding
// stripped). Pre-computed with Node's crypto so the test is self-contained.
const FIXTURE_XML = '<Faktura>test-fixture</Faktura>';
const FIXTURE_XML_HASH = 'NcIQCHZs-My4vFFE_t-x3y2M2XcBkkftWgYEEJA-Ts0';

describe('resolveKsefVerificationHost', () => {
  it('should resolve prod to the production verification host', () => {
    expect(resolveKsefVerificationHost('prod')).toBe('ksef.mf.gov.pl');
  });

  it('should resolve test and demo to the test verification host', () => {
    expect(resolveKsefVerificationHost('test')).toBe('qr-test.ksef.mf.gov.pl');
    expect(resolveKsefVerificationHost('demo')).toBe('qr-test.ksef.mf.gov.pl');
  });

  it('should fall back to the test host for unknown/missing environments (never prod)', () => {
    expect(resolveKsefVerificationHost(undefined)).toBe('qr-test.ksef.mf.gov.pl');
    expect(resolveKsefVerificationHost(null)).toBe('qr-test.ksef.mf.gov.pl');
    expect(resolveKsefVerificationHost('production')).toBe('qr-test.ksef.mf.gov.pl');
    expect(resolveKsefVerificationHost('')).toBe('qr-test.ksef.mf.gov.pl');
  });
});

describe('formatIssueDateForVerification', () => {
  it('should reformat ISO YYYY-MM-DD to DD-MM-RRRR', () => {
    expect(formatIssueDateForVerification('2026-07-01')).toBe('01-07-2026');
    expect(formatIssueDateForVerification('2026-12-31')).toBe('31-12-2026');
  });

  it('should return null for non-ISO or missing dates', () => {
    expect(formatIssueDateForVerification(null)).toBeNull();
    expect(formatIssueDateForVerification(undefined)).toBeNull();
    expect(formatIssueDateForVerification('')).toBeNull();
    expect(formatIssueDateForVerification('01-07-2026')).toBeNull();
    expect(formatIssueDateForVerification('2026/07/01')).toBeNull();
    expect(formatIssueDateForVerification('2026-07-01T00:00:00Z')).toBeNull();
  });
});

describe('bytesToBase64Url', () => {
  it('should use the URL-safe alphabet and strip padding', () => {
    // 0xFF 0xFF 0xFE -> std base64 "///+" -> URL-safe "___-" ('/'->'_', '+'->'-').
    expect(bytesToBase64Url(new Uint8Array([0xff, 0xff, 0xfe]))).toBe('___-');
    // Single byte 0x00 -> std "AA==" -> padding stripped.
    expect(bytesToBase64Url(new Uint8Array([0x00]))).toBe('AA');
  });
});

describe('sha256Base64Url', () => {
  it('should hash exact UTF-8 bytes and Base64URL-encode the digest', async () => {
    await expect(sha256Base64Url(FIXTURE_XML)).resolves.toBe(FIXTURE_XML_HASH);
  });
});

describe('buildKsefVerificationUrl', () => {
  it('should assemble the full verification URL for a prod connection', async () => {
    const url = await buildKsefVerificationUrl({
      environment: 'prod',
      sellerNip: '1234567890',
      issueDateIso: '2026-07-01',
      xmlText: FIXTURE_XML,
    });
    expect(url).toBe(`https://ksef.mf.gov.pl/invoice/1234567890/01-07-2026/${FIXTURE_XML_HASH}`);
  });

  it('should use the test host for a test connection', async () => {
    const url = await buildKsefVerificationUrl({
      environment: 'test',
      sellerNip: '1234567890',
      issueDateIso: '2026-07-01',
      xmlText: FIXTURE_XML,
    });
    expect(url).toBe(
      `https://qr-test.ksef.mf.gov.pl/invoice/1234567890/01-07-2026/${FIXTURE_XML_HASH}`,
    );
  });

  it('should normalize a NIP that carries dashes/spaces', async () => {
    const url = await buildKsefVerificationUrl({
      environment: 'prod',
      sellerNip: '123-456-78-90',
      issueDateIso: '2026-07-01',
      xmlText: FIXTURE_XML,
    });
    expect(url).toContain('/invoice/1234567890/');
  });

  it('should return null when a required input is missing/malformed', async () => {
    const base = {
      environment: 'prod',
      sellerNip: '1234567890',
      issueDateIso: '2026-07-01',
      xmlText: FIXTURE_XML,
    };
    await expect(buildKsefVerificationUrl({ ...base, sellerNip: null })).resolves.toBeNull();
    await expect(buildKsefVerificationUrl({ ...base, sellerNip: '' })).resolves.toBeNull();
    await expect(buildKsefVerificationUrl({ ...base, issueDateIso: 'nope' })).resolves.toBeNull();
    await expect(buildKsefVerificationUrl({ ...base, xmlText: '' })).resolves.toBeNull();
  });
});
