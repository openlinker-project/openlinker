/**
 * Allegro Plugin Smoke Tests
 *
 * Asserts the registered fields are present. Behavioural coverage of each
 * contributed component lives in the consumer-side tests
 * (`platform-picker.test.tsx`, `EditConnectionForm.test.tsx`, etc.).
 */
import { describe, expect, it } from 'vitest';
import { allegroPlugin } from './allegro.plugin';

describe('allegroPlugin', () => {
  it('declares the expected platform key + display name', () => {
    expect(allegroPlugin.platformType).toBe('allegro');
    expect(allegroPlugin.displayName).toBe('Allegro');
  });

  it('contributes the setup card pointing to the guided wizard', () => {
    expect(allegroPlugin.setupCard).toBeDefined();
    expect(allegroPlugin.setupCard?.to).toBe('/connections/new/allegro');
  });

  it('marks itself as requiring an external auth redirect (OAuth)', () => {
    expect(allegroPlugin.requiresExternalAuthRedirect).toBe(true);
  });

  it('contributes the GPSR extra-config section and the edit-offer affordance', () => {
    expect(allegroPlugin.ExtraConfigSection).toBeDefined();
    expect(allegroPlugin.supportsListingEdit).toBe(true);
  });

  it('does NOT contribute structured-config / credentials / connection-actions slots', () => {
    expect(allegroPlugin.StructuredConfigSection).toBeUndefined();
    expect(allegroPlugin.CredentialsPanel).toBeUndefined();
    expect(allegroPlugin.ConnectionActions).toBeUndefined();
  });

  it('does NOT contribute a callback-URL default (PS-only affordance)', () => {
    expect(allegroPlugin.getCallbackUrlDefault).toBeUndefined();
  });
});
