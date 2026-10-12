/**
 * shoperPlugin smoke tests
 *
 * Asserts the plugin's static surface (identity, the guided setup route, the
 * setup card) and that the live plugin registry includes it. Behavioural
 * coverage lives in `shoper-setup-form.test.tsx`.
 *
 * @module plugins/shoper
 */
import { describe, expect, it } from 'vitest';

import { plugins } from '../index';
import { shoperPlugin } from './index';

describe('shoperPlugin', () => {
  it('has the stable id and matching platformType', () => {
    expect(shoperPlugin.id).toBe('shoper');
    expect(shoperPlugin.platformType).toBe('shoper');
  });

  it('contributes the guided setup route', () => {
    const paths = (shoperPlugin.build?.routes ?? []).map((route) => route.path);
    expect(paths).toContain('connections/new/shoper');
  });

  it('declares the display name and a setup card pointing at the wizard', () => {
    expect(shoperPlugin.platform?.displayName).toBe('Shoper');
    expect(shoperPlugin.platform?.setupCard?.to).toBe('/connections/new/shoper');
  });

  it('is registered in the live plugin registry', () => {
    expect(plugins).toContain(shoperPlugin);
  });

  it('contributes the order defaults section together with its config contribution', () => {
    expect(shoperPlugin.platform?.StructuredConfigSection).toBeDefined();
    expect(Object.keys(shoperPlugin.platform?.connectionConfig?.schemaShape ?? {}).sort()).toEqual([
      'shoperPaymentId',
      'shoperShippingId',
      'shoperStatusId',
    ]);
  });
});
