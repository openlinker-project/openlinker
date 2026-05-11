/**
 * PrestaShop Plugin Smoke Tests
 *
 * Asserts the registered fields are present and that `getCallbackUrlDefault`
 * honours `window.location.origin` in jsdom. Behavioural coverage of each
 * contributed component lives in the consumer-side tests
 * (`platform-picker.test.tsx`, `ConnectionActionsPanel.test.tsx`,
 * `EditConnectionForm.test.tsx`).
 */
import { describe, expect, it } from 'vitest';
import { prestashopPlatformPlugin } from './prestashop.plugin';

describe('prestashopPlatformPlugin', () => {
  it('declares the expected platform key + display name', () => {
    expect(prestashopPlatformPlugin.platformType).toBe('prestashop');
    expect(prestashopPlatformPlugin.displayName).toBe('PrestaShop');
  });

  it('contributes the setup card pointing to the guided wizard', () => {
    expect(prestashopPlatformPlugin.setupCard).toBeDefined();
    expect(prestashopPlatformPlugin.setupCard?.to).toBe('/connections/new/prestashop');
  });

  it('contributes structured-config + credentials + actions slots', () => {
    expect(prestashopPlatformPlugin.StructuredConfigSection).toBeDefined();
    expect(prestashopPlatformPlugin.CredentialsPanel).toBeDefined();
    expect(prestashopPlatformPlugin.ConnectionActions).toBeDefined();
  });

  it('does NOT contribute an extra config section (PS has no Allegro-like extra block)', () => {
    expect(prestashopPlatformPlugin.ExtraConfigSection).toBeUndefined();
  });

  it('does NOT mark itself as external-auth-redirect (PS uses inline credentials)', () => {
    expect(prestashopPlatformPlugin.requiresExternalAuthRedirect).toBeUndefined();
  });

  it('returns window.location.origin from getCallbackUrlDefault under jsdom', () => {
    expect(prestashopPlatformPlugin.getCallbackUrlDefault?.()).toBe(window.location.origin);
  });
});
