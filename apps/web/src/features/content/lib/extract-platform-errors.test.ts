/**
 * extractPlatformErrors — unit tests
 *
 * Covers the registry-dispatch helper (#613). The Allegro-specific
 * shape-matching is tested separately under
 * `plugins/allegro/extract-content-publish-errors.test.ts`; these tests
 * exercise dispatch behaviour with stubbed plugins.
 *
 * @module features/content/lib
 */
import { describe, expect, it } from 'vitest';
import { extractPlatformErrors } from './extract-platform-errors';
import type { PlatformPlugin } from '../../../shared/plugins';
import type { StructuredError } from '../../../shared/types/structured-error.types';

function stubPlugin(
  platformType: string,
  extractor?: PlatformPlugin['extractContentPublishErrors'],
): PlatformPlugin {
  return {
    platformType,
    displayName: platformType,
    ...(extractor ? { extractContentPublishErrors: extractor } : {}),
  };
}

const sampleErrors: StructuredError[] = [
  { code: 'X', message: 'something went wrong' },
];

describe('extractPlatformErrors', () => {
  it('returns null when the plugin list is empty', () => {
    expect(extractPlatformErrors(new Error('x'), [])).toBeNull();
  });

  it('returns null when no plugin implements extractContentPublishErrors', () => {
    const plugins = [stubPlugin('foo'), stubPlugin('bar')];
    expect(extractPlatformErrors(new Error('x'), plugins)).toBeNull();
  });

  it('returns null when every implementing plugin returns null', () => {
    const plugins = [
      stubPlugin('foo', () => null),
      stubPlugin('bar', () => null),
    ];
    expect(extractPlatformErrors(new Error('x'), plugins)).toBeNull();
  });

  it('returns the first non-null extraction (chain-of-responsibility)', () => {
    const plugins = [
      stubPlugin('foo', () => null),
      stubPlugin('bar', () => sampleErrors),
      stubPlugin('baz', () => [{ code: 'Y', message: 'unused' }]),
    ];
    expect(extractPlatformErrors(new Error('x'), plugins)).toEqual(sampleErrors);
  });

  it('treats undefined like null and keeps trying', () => {
    const plugins = [
      stubPlugin('foo', () => null),
      stubPlugin('bar', () => sampleErrors),
    ];
    expect(extractPlatformErrors(new Error('x'), plugins)).toEqual(sampleErrors);
  });
});
