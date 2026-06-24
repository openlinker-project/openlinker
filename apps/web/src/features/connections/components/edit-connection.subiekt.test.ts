/**
 * Subiekt schema merge/read tests (#759)
 *
 * Pins the three persistence seams added for #759 against
 * `mergeStructuredIntoConfig`. These are pure-function assertions — the
 * cheapest, highest-value guard for the flat/nested/whole-object seams.
 * Read-back / hydration behaviour (which renders the form) lives in the
 * component test (`subiekt-structured-section.test.tsx`).
 *
 * @module features/connections/components
 */
import { describe, expect, it } from 'vitest';
import { mergeStructuredIntoConfig } from './edit-connection.schema';

describe('mergeStructuredIntoConfig — Subiekt (#759)', () => {
  describe('bridge URL (flat seam)', () => {
    it('writes a non-empty subiektBridgeUrl flat onto config.subiektBridgeUrl', () => {
      const out = mergeStructuredIntoConfig(
        {},
        { subiektBridgeUrl: 'https://localhost:5005' },
      );
      expect(out.subiektBridgeUrl).toBe('https://localhost:5005');
    });

    it('deletes config.subiektBridgeUrl when the value is empty (delete-on-empty)', () => {
      const out = mergeStructuredIntoConfig(
        { subiektBridgeUrl: 'https://old.example.com' },
        { subiektBridgeUrl: '' },
      );
      expect('subiektBridgeUrl' in out).toBe(false);
    });
  });

  describe('trigger model (nested seam)', () => {
    it('writes the trigger model to config.invoicing.triggerModel, NOT a flat key', () => {
      const out = mergeStructuredIntoConfig({}, { subiektTriggerModel: 'auto-on-paid' });
      expect(out.invoicing).toEqual({ triggerModel: 'auto-on-paid' });
      expect('subiektTriggerModel' in out).toBe(false);
      expect('triggerModel' in out).toBe(false);
    });

    it('preserves sibling config.invoicing keys', () => {
      const out = mergeStructuredIntoConfig(
        { invoicing: { numbering: 'FV/{yyyy}', triggerModel: 'manual' } },
        { subiektTriggerModel: 'batched' },
      );
      expect(out.invoicing).toEqual({ numbering: 'FV/{yyyy}', triggerModel: 'batched' });
    });

    it('drops an emptied config.invoicing object when triggerModel is cleared', () => {
      const out = mergeStructuredIntoConfig(
        { invoicing: { triggerModel: 'manual' } },
        { subiektTriggerModel: '' },
      );
      expect('invoicing' in out).toBe(false);
    });

    it('keeps config.invoicing when clearing triggerModel leaves a sibling', () => {
      const out = mergeStructuredIntoConfig(
        { invoicing: { numbering: 'FV/{yyyy}', triggerModel: 'manual' } },
        { subiektTriggerModel: '' },
      );
      expect(out.invoicing).toEqual({ numbering: 'FV/{yyyy}' });
    });
  });

  describe('capability toggles (whole-object seam)', () => {
    it('writes the boolean record under config.capabilities', () => {
      const out = mergeStructuredIntoConfig(
        {},
        { subiektCapabilities: { 'regulatory-transmission-tracking': true } },
      );
      expect(out.capabilities).toEqual({ 'regulatory-transmission-tracking': true });
    });

    it('drops config.capabilities when the record is empty', () => {
      const out = mergeStructuredIntoConfig(
        { capabilities: { 'regulatory-transmission-tracking': true } },
        { subiektCapabilities: {} },
      );
      expect('capabilities' in out).toBe(false);
    });

    it('round-trips ON then OFF — second write persists false (ordering trap)', () => {
      const on = mergeStructuredIntoConfig(
        {},
        { subiektCapabilities: { 'regulatory-transmission-tracking': true } },
      );
      expect(on.capabilities).toEqual({ 'regulatory-transmission-tracking': true });

      const off = mergeStructuredIntoConfig(on, {
        subiektCapabilities: { 'regulatory-transmission-tracking': false },
      });
      expect(off.capabilities).toEqual({ 'regulatory-transmission-tracking': false });
    });
  });

  describe('unrelated-key preservation (blank-out guard)', () => {
    it('leaves config.invoicing.triggerModel untouched when an unrelated field is merged', () => {
      const base = {
        invoicing: { triggerModel: 'auto-on-shipped' },
        subiektBridgeUrl: 'https://localhost:5005',
      };
      const out = mergeStructuredIntoConfig(base, { baseUrl: 'https://api.example.com' });
      expect(out.invoicing).toEqual({ triggerModel: 'auto-on-shipped' });
      expect(out.baseUrl).toBe('https://api.example.com');
    });
  });
});
