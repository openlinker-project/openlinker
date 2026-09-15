/**
 * eparagony.pl connection-config contribution tests (#3266)
 *
 * The assembly half is where a bug is invisible in the UI and only shows up as
 * a config key that quietly stopped being saved, so the round-trips and the
 * sibling-preservation guarantee are pinned here rather than through the
 * rendered section.
 *
 * @module plugins/eparagony
 */
import { describe, expect, it } from 'vitest';
import { eparagonyConnectionConfig } from './eparagony-connection-config';

const { readConfigToForm, applyToConfig, schemaShape } = eparagonyConnectionConfig;

describe('eparagonyConnectionConfig', () => {
  describe('readConfigToForm', () => {
    it('should read every leaf back as a form string when the config is fully populated', () => {
      expect(
        readConfigToForm({
          print: true,
          paymentForm: 'Karta',
          paymentName: 'Visa',
          defaultTaxRateCode: 'B',
          statusPollTimeoutMs: 45000,
          fiscalDeviceUniqueNumber: 'ABC123',
          apiBaseUrl: 'https://sandbox.eparagony.pl',
          authBaseUrl: 'https://login.sandbox.eparagony.pl',
        }),
      ).toEqual({
        eparagonyPrint: 'true',
        eparagonyPaymentForm: 'Karta',
        eparagonyPaymentName: 'Visa',
        eparagonyDefaultTaxRateCode: 'B',
        eparagonyStatusPollTimeoutMs: '45000',
        eparagonyFiscalDeviceUniqueNumber: 'ABC123',
        eparagonyApiBaseUrl: 'https://sandbox.eparagony.pl',
        eparagonyAuthBaseUrl: 'https://login.sandbox.eparagony.pl',
      });
    });

    it('should read an empty config as every field unset', () => {
      expect(readConfigToForm({})).toEqual({
        eparagonyPrint: '',
        eparagonyPaymentForm: '',
        eparagonyPaymentName: '',
        eparagonyDefaultTaxRateCode: '',
        eparagonyStatusPollTimeoutMs: '',
        eparagonyFiscalDeviceUniqueNumber: '',
        eparagonyApiBaseUrl: '',
        eparagonyAuthBaseUrl: '',
      });
    });

    it('should keep an explicit print:false distinct from an absent print', () => {
      expect(readConfigToForm({ print: false }).eparagonyPrint).toBe('false');
      expect(readConfigToForm({}).eparagonyPrint).toBe('');
    });

    it('should read an unrecognised print value as unset rather than coercing it', () => {
      // A hand-typed `"yes"` in the raw editor is neither state. Showing it as
      // one would hide a value the backend is about to reject.
      expect(readConfigToForm({ print: 'yes' }).eparagonyPrint).toBe('');
    });

    it('should read a value outside a closed vocabulary as unset', () => {
      expect(readConfigToForm({ paymentForm: 'Bitcoin' }).eparagonyPaymentForm).toBe('');
      expect(readConfigToForm({ defaultTaxRateCode: 'Z' }).eparagonyDefaultTaxRateCode).toBe('');
    });

    it('should read a non-numeric poll timeout as unset', () => {
      expect(readConfigToForm({ statusPollTimeoutMs: '45000' }).eparagonyStatusPollTimeoutMs).toBe(
        '',
      );
    });
  });

  describe('applyToConfig', () => {
    it('should write all three print states distinctly', () => {
      expect(applyToConfig({}, { eparagonyPrint: 'true' })).toEqual({ print: true });
      expect(applyToConfig({}, { eparagonyPrint: 'false' })).toEqual({ print: false });
      expect(applyToConfig({ print: true }, { eparagonyPrint: '' })).toEqual({});
    });

    it('should parse the poll timeout into a number', () => {
      expect(applyToConfig({}, { eparagonyStatusPollTimeoutMs: '45000' })).toEqual({
        statusPollTimeoutMs: 45000,
      });
    });

    it('should delete rather than write NaN for a half-typed poll timeout', () => {
      // The schema reports the error; the config must stay a shape the backend
      // would accept if the operator saved mid-edit.
      expect(applyToConfig({ statusPollTimeoutMs: 45000 }, { eparagonyStatusPollTimeoutMs: '-' }))
        .toEqual({});
    });

    it('should trim a text leaf and delete it when cleared', () => {
      expect(applyToConfig({}, { eparagonyPaymentName: '  Visa  ' })).toEqual({
        paymentName: 'Visa',
      });
      expect(applyToConfig({ paymentName: 'Visa' }, { eparagonyPaymentName: '   ' })).toEqual({});
    });

    it('should preserve an unknown operator-authored key through a single-field patch', () => {
      // The raw JSON editor lets an operator add keys this build knows nothing
      // about. A per-keystroke patch must never be what removes them.
      const config = { posId: 'openlinker', someFutureKey: { nested: true } };
      expect(applyToConfig(config, { eparagonyPrint: 'true' })).toEqual({
        posId: 'openlinker',
        someFutureKey: { nested: true },
        print: true,
      });
    });

    it('should preserve untouched siblings through a single-field patch', () => {
      const config = { print: true, paymentForm: 'Karta', paymentName: 'Visa' };
      expect(applyToConfig(config, { eparagonyPaymentName: 'Mastercard' })).toEqual({
        print: true,
        paymentForm: 'Karta',
        paymentName: 'Mastercard',
      });
    });

    it('should not mutate the config it was given', () => {
      const config = { print: true };
      applyToConfig(config, { eparagonyPrint: 'false' });
      expect(config).toEqual({ print: true });
    });

    it('should ignore a patch carrying none of its fields', () => {
      const config = { posId: 'openlinker' };
      expect(applyToConfig(config, { someOtherPluginField: 'x' })).toEqual(config);
    });

    it('should round-trip every field through apply and read', () => {
      const form = {
        eparagonyPrint: 'false',
        eparagonyPaymentForm: 'Gotowka',
        eparagonyPaymentName: 'Cash on delivery',
        eparagonyDefaultTaxRateCode: 'C',
        eparagonyStatusPollTimeoutMs: '30000',
        eparagonyFiscalDeviceUniqueNumber: 'DEV-1',
        eparagonyApiBaseUrl: 'https://api.eparagony.pl',
        eparagonyAuthBaseUrl: 'https://login.eparagony.pl',
      };
      expect(readConfigToForm(applyToConfig({}, form))).toEqual(form);
    });
  });

  describe('schemaShape', () => {
    it('should declare exactly the eight fields the section renders', () => {
      expect(Object.keys(schemaShape).sort()).toEqual([
        'eparagonyApiBaseUrl',
        'eparagonyAuthBaseUrl',
        'eparagonyDefaultTaxRateCode',
        'eparagonyFiscalDeviceUniqueNumber',
        'eparagonyPaymentForm',
        'eparagonyPaymentName',
        'eparagonyPrint',
        'eparagonyStatusPollTimeoutMs',
      ]);
    });

    it('should accept a long payment name, because the backend puts no bound on it', () => {
      // #2240: a form rule stricter than the gate refuses what the destination
      // would have accepted.
      const parsed = schemaShape.eparagonyPaymentName?.safeParse('x'.repeat(2000));
      expect(parsed?.success).toBe(true);
    });

    it('should accept a poll timeout above the adapter clamp, which clamps rather than rejects', () => {
      expect(schemaShape.eparagonyStatusPollTimeoutMs?.safeParse('600000').success).toBe(true);
    });

    it('should refuse a non-numeric or zero poll timeout', () => {
      expect(schemaShape.eparagonyStatusPollTimeoutMs?.safeParse('soon').success).toBe(false);
      expect(schemaShape.eparagonyStatusPollTimeoutMs?.safeParse('0').success).toBe(false);
    });

    it('should refuse a non-https host override', () => {
      expect(schemaShape.eparagonyApiBaseUrl?.safeParse('http://insecure.test').success).toBe(
        false,
      );
      expect(schemaShape.eparagonyApiBaseUrl?.safeParse('not a url').success).toBe(false);
      expect(schemaShape.eparagonyApiBaseUrl?.safeParse('https://ok.test').success).toBe(true);
      expect(schemaShape.eparagonyApiBaseUrl?.safeParse('').success).toBe(true);
    });

    it('should refuse a payment form outside the vendor vocabulary', () => {
      expect(schemaShape.eparagonyPaymentForm?.safeParse('Bitcoin').success).toBe(false);
      expect(schemaShape.eparagonyPaymentForm?.safeParse('Przelew').success).toBe(true);
    });
  });
});
