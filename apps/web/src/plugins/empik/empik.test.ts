/**
 * empikPlugin smoke tests
 *
 * The plugin's static surface for #4274: identity, the guided setup route,
 * the setup card and the credentials panel. Offer and order slots are not
 * contributed yet; they arrive with the capabilities (#4275, #4277).
 *
 * @module plugins/empik
 */
import { describe, expect, it } from 'vitest';

import { empikPlugin } from './index';

describe('empikPlugin', () => {
  it('should use the empik id and platform type', () => {
    expect(empikPlugin.id).toBe('empik');
    expect(empikPlugin.platformType).toBe('empik');
  });

  it('should contribute the guided setup route', () => {
    const paths = (empikPlugin.build?.routes ?? []).map((route) => route.path);
    expect(paths).toContain('connections/new/empik');
  });

  it('should contribute a setup card pointing to the wizard', () => {
    expect(empikPlugin.platform?.displayName).toBe('Empik Marketplace');
    expect(empikPlugin.platform?.setupCard?.to).toBe('/connections/new/empik');
    expect(empikPlugin.platform?.setupCard?.badge).toBe('API key');
  });

  it('should contribute a credentials panel and the offer wizard slots (#4278)', () => {
    expect(empikPlugin.platform?.CredentialsPanel).toBeDefined();
    expect(empikPlugin.platform?.bulkOfferConfigSection?.isComplete).toBeDefined();
    expect(empikPlugin.platform?.offerValidation?.blockers.map((blocker) => blocker.id)).toEqual([
      'empik:no-card',
    ]);
    expect(empikPlugin.platform?.supportsListingEdit).toBeUndefined();
  });
});
