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
import { prestashopPlugin } from './prestashop.plugin';

describe('prestashopPlugin', () => {
  it('declares the expected platform key + display name', () => {
    expect(prestashopPlugin.platformType).toBe('prestashop');
    expect(prestashopPlugin.displayName).toBe('PrestaShop');
  });

  it('contributes the setup card pointing to the guided wizard', () => {
    expect(prestashopPlugin.setupCard).toBeDefined();
    expect(prestashopPlugin.setupCard?.to).toBe('/connections/new/prestashop');
  });

  it('contributes structured-config + credentials + actions slots', () => {
    expect(prestashopPlugin.StructuredConfigSection).toBeDefined();
    expect(prestashopPlugin.CredentialsPanel).toBeDefined();
    expect(prestashopPlugin.ConnectionActions).toBeDefined();
  });

  it('does NOT contribute an extra config section (PS has no Allegro-like extra block)', () => {
    expect(prestashopPlugin.ExtraConfigSection).toBeUndefined();
  });

  it('does NOT mark itself as external-auth-redirect (PS uses inline credentials)', () => {
    expect(prestashopPlugin.requiresExternalAuthRedirect).toBeUndefined();
  });

  it('returns window.location.origin from getCallbackUrlDefault under jsdom', () => {
    expect(prestashopPlugin.getCallbackUrlDefault?.()).toBe(window.location.origin);
  });
});
