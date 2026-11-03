/**
 * MF trust-anchor loader specs.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MF_ROOT_CA_PATH_ENV,
  loadMfTrustAnchors,
  resetMfTrustAnchorsCacheForTests,
} from '../mf-trust-anchors';
import { TEST_CA1_PEM, TEST_CA2_PEM } from './certificate-fixtures';

describe('loadMfTrustAnchors', () => {
  const original = process.env[MF_ROOT_CA_PATH_ENV];
  let tmp: string;

  beforeEach(() => {
    resetMfTrustAnchorsCacheForTests();
    tmp = mkdtempSync(join(tmpdir(), 'ksef-ca-'));
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[MF_ROOT_CA_PATH_ENV];
    } else {
      process.env[MF_ROOT_CA_PATH_ENV] = original;
    }
    resetMfTrustAnchorsCacheForTests();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('should return no anchors when the env var is unset (chain check skipped)', () => {
    delete process.env[MF_ROOT_CA_PATH_ENV];
    expect(loadMfTrustAnchors()).toHaveLength(0);
  });

  it('should load a single-cert PEM file from the configured path', () => {
    const path = join(tmp, 'ca.pem');
    writeFileSync(path, TEST_CA1_PEM);
    process.env[MF_ROOT_CA_PATH_ENV] = path;
    expect(loadMfTrustAnchors()).toHaveLength(1);
  });

  it('should load every cert from a concatenated PEM bundle', () => {
    const path = join(tmp, 'bundle.pem');
    writeFileSync(path, `${TEST_CA1_PEM}\n${TEST_CA2_PEM}`);
    process.env[MF_ROOT_CA_PATH_ENV] = path;
    expect(loadMfTrustAnchors()).toHaveLength(2);
  });

  it('should return no anchors when the configured path is unreadable', () => {
    process.env[MF_ROOT_CA_PATH_ENV] = join(tmp, 'does-not-exist.pem');
    expect(loadMfTrustAnchors()).toHaveLength(0);
  });

  it('should memoize the result across calls', () => {
    const path = join(tmp, 'ca.pem');
    writeFileSync(path, TEST_CA1_PEM);
    process.env[MF_ROOT_CA_PATH_ENV] = path;
    const first = loadMfTrustAnchors();
    // Change the env after first load; memoized result must be unchanged.
    delete process.env[MF_ROOT_CA_PATH_ENV];
    expect(loadMfTrustAnchors()).toBe(first);
  });
});
