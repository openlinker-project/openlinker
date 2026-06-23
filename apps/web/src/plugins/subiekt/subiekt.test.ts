/**
 * subiektPlugin invariant tests (#759)
 *
 * Static-surface coverage: plugin identity, the trigger-model mirror staying
 * in lockstep with the feature-layer source of truth, and the capability
 * descriptor map. Behavioural coverage lives in the consumer-side tests.
 *
 * @module plugins/subiekt
 */
import { describe, expect, it } from 'vitest';
import { INVOICE_TRIGGER_MODEL_VALUES } from '../../features/connections';
import { subiektPlugin } from './index';
import {
  SUBIEKT_CAPABILITY_DESCRIPTORS,
  SUBIEKT_TRIGGER_MODELS,
} from './subiekt-capability-descriptors';

describe('subiektPlugin', () => {
  it('has the stable kebab-case id "subiekt"', () => {
    expect(subiektPlugin.id).toBe('subiekt');
  });

  it('declares the matching platformType "subiekt"', () => {
    expect(subiektPlugin.platformType).toBe('subiekt');
  });

  it('contributes StructuredConfigSection + CredentialsPanel + capabilityDescriptors', () => {
    expect(subiektPlugin.platform?.StructuredConfigSection).toBeDefined();
    expect(subiektPlugin.platform?.CredentialsPanel).toBeDefined();
    expect(subiektPlugin.platform?.capabilityDescriptors).toBe(SUBIEKT_CAPABILITY_DESCRIPTORS);
  });

  it('does NOT contribute a setup route or ConnectionActions (out of scope / generic Test reused)', () => {
    expect(subiektPlugin.platform?.setupCard).toBeUndefined();
    expect(subiektPlugin.build?.routes ?? []).toHaveLength(0);
  });

  it('SUBIEKT_TRIGGER_MODELS equals the 4 values [manual, auto-on-paid, auto-on-shipped, batched]', () => {
    expect([...SUBIEKT_TRIGGER_MODELS]).toEqual([
      'manual',
      'auto-on-paid',
      'auto-on-shipped',
      'batched',
    ]);
    // Stays in lockstep with the feature-layer source of truth (no drift).
    expect([...SUBIEKT_TRIGGER_MODELS]).toEqual([...INVOICE_TRIGGER_MODEL_VALUES]);
  });

  it('capabilityDescriptors contains regulatory-transmission-tracking', () => {
    expect(SUBIEKT_CAPABILITY_DESCRIPTORS).toHaveProperty('regulatory-transmission-tracking');
    expect(SUBIEKT_CAPABILITY_DESCRIPTORS['regulatory-transmission-tracking'].label).toBeTruthy();
  });
});
