/**
 * Shoper connection-config contribution tests (#3702)
 *
 * The assembly half is where a bug is invisible in the UI and only shows up as
 * an id that quietly stopped being saved, so round-trips and sibling
 * preservation are pinned here rather than through the rendered section.
 *
 * @module plugins/shoper
 */
import { describe, expect, it } from 'vitest';
import { shoperConnectionConfig } from './shoper-connection-config';

const { readConfigToForm, applyToConfig, schemaShape } = shoperConnectionConfig;

describe('shoperConnectionConfig', () => {
  describe('readConfigToForm', () => {
    it('should read the three ids back as strings', () => {
      expect(readConfigToForm({ defaults: { shippingId: 8, paymentId: 1, statusId: 3 } })).toEqual({
        shoperShippingId: '8',
        shoperPaymentId: '1',
        shoperStatusId: '3',
      });
    });

    it('should read every field as empty when there are no defaults, or defaults is null', () => {
      const empty = { shoperShippingId: '', shoperPaymentId: '', shoperStatusId: '' };
      expect(readConfigToForm({})).toEqual(empty);
      expect(readConfigToForm({ defaults: null })).toEqual(empty);
      expect(readConfigToForm({ defaults: 'oops' })).toEqual(empty);
    });

    it('should not invent a value for a non-positive or non-integer stored id', () => {
      expect(readConfigToForm({ defaults: { shippingId: 0, paymentId: -2, statusId: 1.5 } })).toEqual({
        shoperShippingId: '',
        shoperPaymentId: '',
        shoperStatusId: '',
      });
    });
  });

  describe('applyToConfig', () => {
    it('should write the id as a number under defaults and keep the operator\'s other keys', () => {
      expect(
        applyToConfig({ baseUrl: 'shop.example.com', extra: true }, { shoperPaymentId: '4' }),
      ).toEqual({ baseUrl: 'shop.example.com', extra: true, defaults: { paymentId: 4 } });
    });

    it('should preserve sibling defaults when one field is patched', () => {
      expect(
        applyToConfig({ defaults: { shippingId: 8, statusId: 1 } }, { shoperStatusId: '2' }),
      ).toEqual({ defaults: { shippingId: 8, statusId: 2 } });
    });

    it('should drop only the cleared leaf', () => {
      expect(
        applyToConfig({ defaults: { shippingId: 8, paymentId: 1 } }, { shoperPaymentId: '' }),
      ).toEqual({ defaults: { shippingId: 8 } });
    });

    it('should keep the defaults key as null once nothing is set, so the submit merge cannot restore it', () => {
      expect(applyToConfig({ defaults: { paymentId: 1 } }, { shoperPaymentId: '' })).toEqual({
        defaults: null,
      });
    });

    it('should leave the config untouched when the patch carries no Shoper field', () => {
      const config = { baseUrl: 'a', defaults: { statusId: 1 } };
      expect(applyToConfig(config, { somethingElse: 'x' })).toEqual(config);
    });

    it('should not write a half-typed or non-positive value', () => {
      expect(applyToConfig({}, { shoperShippingId: '12abc' })).toEqual({ defaults: null });
      expect(applyToConfig({}, { shoperShippingId: '0' })).toEqual({ defaults: null });
    });
  });

  describe('schemaShape', () => {
    it.each(['shoperShippingId', 'shoperPaymentId', 'shoperStatusId'] as const)(
      'should accept empty and a positive integer, and refuse anything else for %s',
      (field) => {
        const schema = schemaShape[field]!;
        expect(schema.safeParse('').success).toBe(true);
        expect(schema.safeParse(undefined).success).toBe(true);
        expect(schema.safeParse('12').success).toBe(true);
        expect(schema.safeParse('0').success).toBe(false);
        expect(schema.safeParse('-3').success).toBe(false);
        expect(schema.safeParse('1.5').success).toBe(false);
        expect(schema.safeParse('abc').success).toBe(false);
      },
    );
  });
});
