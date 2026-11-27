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

  // #3582: the form writes the kind-scoped `invoice` key the BE gate reads
  // first, and drops the legacy key it would otherwise be shadowed by.
  describe('trigger model (kind-scoped seam, #3582)', () => {
    it('writes the trigger model to config.salesDocument.triggerModels.invoice, NOT a flat key', () => {
      const out = mergeStructuredIntoConfig({}, { subiektTriggerModel: 'auto-on-paid' });
      expect(out.salesDocument).toEqual({ triggerModels: { invoice: 'auto-on-paid' } });
      expect('invoicing' in out).toBe(false);
      expect('subiektTriggerModel' in out).toBe(false);
      expect('triggerModel' in out).toBe(false);
    });

    it('drops the legacy key and preserves sibling config.invoicing keys and documentKind', () => {
      const out = mergeStructuredIntoConfig(
        {
          invoicing: { numbering: 'FV/{yyyy}', triggerModel: 'manual' },
          salesDocument: { documentKind: 'invoice' },
        },
        { subiektTriggerModel: 'batched' },
      );
      expect(out.invoicing).toEqual({ numbering: 'FV/{yyyy}' });
      expect(out.salesDocument).toEqual({
        documentKind: 'invoice',
        triggerModels: { invoice: 'batched' },
      });
    });

    it('overrides a kind-scoped value the sales-documents table already set', () => {
      const out = mergeStructuredIntoConfig(
        { salesDocument: { triggerModels: { invoice: 'manual', 'fiscal-receipt': 'auto-on-paid' } } },
        { subiektTriggerModel: 'auto-on-shipped' },
      );
      expect(out.salesDocument).toEqual({
        triggerModels: { invoice: 'auto-on-shipped', 'fiscal-receipt': 'auto-on-paid' },
      });
    });

    it('drops emptied objects when the trigger model is cleared', () => {
      const out = mergeStructuredIntoConfig(
        { invoicing: { triggerModel: 'manual' }, salesDocument: { triggerModels: { invoice: 'manual' } } },
        { subiektTriggerModel: '' },
      );
      expect('invoicing' in out).toBe(false);
      expect('salesDocument' in out).toBe(false);
    });

    it('keeps config.invoicing when clearing the trigger model leaves a sibling', () => {
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

    it('round-trips ON then OFF — second write DROPS the key (off is absence, not {key:false})', () => {
      const on = mergeStructuredIntoConfig(
        {},
        { subiektCapabilities: { 'regulatory-transmission-tracking': true } },
      );
      expect(on.capabilities).toEqual({ 'regulatory-transmission-tracking': true });

      // Toggling the only capability OFF persists ABSENCE — an all-off
      // connection carries no `capabilities` blob, so a presence-checking BE
      // reader cannot misread a lingering `{ key: false }` as enabled.
      const off = mergeStructuredIntoConfig(on, {
        subiektCapabilities: { 'regulatory-transmission-tracking': false },
      });
      expect('capabilities' in off).toBe(false);
    });

    it('persists only the enabled toggles when the record mixes true and false', () => {
      const out = mergeStructuredIntoConfig(
        {},
        {
          subiektCapabilities: {
            'regulatory-transmission-tracking': true,
            'some-other-toggle': false,
          },
        },
      );
      expect(out.capabilities).toEqual({ 'regulatory-transmission-tracking': true });
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
