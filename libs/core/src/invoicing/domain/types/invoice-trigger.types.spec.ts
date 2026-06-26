/**
 * parseTriggerModel unit tests (OL #1120).
 *
 * @module libs/core/src/invoicing/domain/types
 */
import { parseTriggerModel, InvoiceTriggerModelValues } from './invoice-trigger.types';

describe('parseTriggerModel', () => {
  it('returns each known value verbatim (manual / auto-on-paid / auto-on-shipped / batched)', () => {
    for (const value of InvoiceTriggerModelValues) {
      expect(parseTriggerModel(value)).toBe(value);
    }
  });

  it('returns "manual" for undefined / null', () => {
    expect(parseTriggerModel(undefined)).toBe('manual');
    expect(parseTriggerModel(null)).toBe('manual');
  });

  it('returns "manual" for an unrecognized string', () => {
    expect(parseTriggerModel('auto-on-delivered')).toBe('manual');
    expect(parseTriggerModel('')).toBe('manual');
  });

  it('returns "manual" for a non-string value', () => {
    expect(parseTriggerModel(42)).toBe('manual');
    expect(parseTriggerModel({ triggerModel: 'auto-on-paid' })).toBe('manual');
    expect(parseTriggerModel(['auto-on-paid'])).toBe('manual');
  });

  it('exposes the four trigger-model values', () => {
    expect(InvoiceTriggerModelValues).toHaveLength(4);
  });
});
