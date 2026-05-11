/**
 * Allegro Plugin Smoke Tests
 *
 * Asserts the registered fields are present. Behavioural coverage of each
 * contributed component lives in the consumer-side tests
 * (`platform-picker.test.tsx`, `EditConnectionForm.test.tsx`, etc.).
 */
import { describe, expect, it } from 'vitest';
import { allegroPlatformPlugin } from './allegro.plugin';

describe('allegroPlatformPlugin', () => {
  it('declares the expected platform key + display name', () => {
    expect(allegroPlatformPlugin.platformType).toBe('allegro');
    expect(allegroPlatformPlugin.displayName).toBe('Allegro');
  });

  it('contributes the setup card pointing to the guided wizard', () => {
    expect(allegroPlatformPlugin.setupCard).toBeDefined();
    expect(allegroPlatformPlugin.setupCard?.to).toBe('/connections/new/allegro');
  });

  it('marks itself as requiring an external auth redirect (OAuth)', () => {
    expect(allegroPlatformPlugin.requiresExternalAuthRedirect).toBe(true);
  });

  it('contributes the GPSR extra-config section and the edit-offer affordance', () => {
    expect(allegroPlatformPlugin.ExtraConfigSection).toBeDefined();
    expect(allegroPlatformPlugin.supportsListingEdit).toBe(true);
  });

  it('does NOT contribute structured-config / credentials / connection-actions slots', () => {
    expect(allegroPlatformPlugin.StructuredConfigSection).toBeUndefined();
    expect(allegroPlatformPlugin.CredentialsPanel).toBeUndefined();
    expect(allegroPlatformPlugin.ConnectionActions).toBeUndefined();
  });

  it('does NOT contribute a callback-URL default (PS-only affordance)', () => {
    expect(allegroPlatformPlugin.getCallbackUrlDefault).toBeUndefined();
  });
});
