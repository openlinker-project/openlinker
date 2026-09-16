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
import {
  eparagonyConnectionConfig,
  readUnrecognisedEnumValue,
} from './eparagony-connection-config';
import {
  EPARAGONY_PAYMENT_FORM_VALUES,
  EPARAGONY_TAX_RATE_CODE_VALUES,
} from './eparagony-config.types';

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

    it('should read an explicit null back as unset on every field', () => {
      // `null` is the CLEARED state `applyToConfig` writes (it must, so the
      // clear survives EditConnectionForm's pre-submit merge). Hydration has to
      // read it back as empty, or a cleared connection would reload with the
      // field looking broken rather than blank.
      expect(
        readConfigToForm({
          print: null,
          paymentForm: null,
          paymentName: null,
          defaultTaxRateCode: null,
          statusPollTimeoutMs: null,
          fiscalDeviceUniqueNumber: null,
          apiBaseUrl: null,
          authBaseUrl: null,
        }),
      ).toEqual({
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
  });

  describe('readUnrecognisedEnumValue', () => {
    it('should report a stored value this build does not recognise', () => {
      expect(
        readUnrecognisedEnumValue({ paymentForm: 'Bitcoin' }, 'paymentForm', EPARAGONY_PAYMENT_FORM_VALUES),
      ).toBe('Bitcoin');
      expect(
        readUnrecognisedEnumValue(
          { defaultTaxRateCode: 'Z' },
          'defaultTaxRateCode',
          EPARAGONY_TAX_RATE_CODE_VALUES,
        ),
      ).toBe('Z');
    });

    it('should report nothing for a recognised, absent or cleared value', () => {
      // `null` is the cleared state, absent is never-set. Neither is a value
      // the operator has to go and find, so neither may raise a warning.
      for (const config of [{ paymentForm: 'Karta' }, {}, { paymentForm: null }]) {
        expect(
          readUnrecognisedEnumValue(config, 'paymentForm', EPARAGONY_PAYMENT_FORM_VALUES),
        ).toBeNull();
      }
    });

    it('should render a non-string stored value rather than dropping it', () => {
      expect(readUnrecognisedEnumValue({ paymentForm: 7 }, 'paymentForm', EPARAGONY_PAYMENT_FORM_VALUES)).toBe(
        '7',
      );
    });
  });

  describe('applyToConfig', () => {
    it('should write all three print states distinctly', () => {
      expect(applyToConfig({}, { eparagonyPrint: 'true' })).toEqual({ print: true });
      expect(applyToConfig({}, { eparagonyPrint: 'false' })).toEqual({ print: false });
    });

    it('should write an explicit null for every cleared field, never delete the key', () => {
      // THE key assertion of this file (#3268 review). `EditConnectionForm`
      // merges `{ ...fresh.config, ...input.config }` against a pre-submit
      // refetch, and a shallow spread can only override a key PRESENT on the
      // right side - so a deleted key is silently restored from the refetch and
      // the clear never reaches the server. Reading `'print' in result` rather
      // than the value alone is what makes that difference assertable at all:
      // `toEqual` treats an absent key and `undefined` alike.
      const cleared = applyToConfig(
        {
          print: true,
          paymentForm: 'Karta',
          paymentName: 'Visa',
          defaultTaxRateCode: 'B',
          statusPollTimeoutMs: 45000,
          fiscalDeviceUniqueNumber: 'DEV-1',
          apiBaseUrl: 'https://api.test',
          authBaseUrl: 'https://login.test',
        },
        {
          eparagonyPrint: '',
          eparagonyPaymentForm: '',
          eparagonyPaymentName: '   ',
          eparagonyDefaultTaxRateCode: '',
          eparagonyStatusPollTimeoutMs: '',
          eparagonyFiscalDeviceUniqueNumber: '',
          eparagonyApiBaseUrl: '',
          eparagonyAuthBaseUrl: '',
        },
      );

      expect(cleared).toEqual({
        print: null,
        paymentForm: null,
        paymentName: null,
        defaultTaxRateCode: null,
        statusPollTimeoutMs: null,
        fiscalDeviceUniqueNumber: null,
        apiBaseUrl: null,
        authBaseUrl: null,
      });
      // `toEqual` above cannot tell an absent key from one holding `undefined`,
      // and the whole defect is about a key being absent - so assert presence.
      expect(Object.keys(cleared).sort()).toEqual([
        'apiBaseUrl',
        'authBaseUrl',
        'defaultTaxRateCode',
        'fiscalDeviceUniqueNumber',
        'paymentForm',
        'paymentName',
        'print',
        'statusPollTimeoutMs',
      ]);
    });

    it('should round-trip a cleared field back to unset rather than to its old value', () => {
      // The property the three-state print control is staked on: an explicit
      // choice and an unset knob must round-trip APART.
      const cleared = applyToConfig({ print: true }, { eparagonyPrint: '' });
      expect(readConfigToForm(cleared).eparagonyPrint).toBe('');
    });

    it('should parse the poll timeout into a number', () => {
      expect(applyToConfig({}, { eparagonyStatusPollTimeoutMs: '45000' })).toEqual({
        statusPollTimeoutMs: 45000,
      });
    });

    it('should clear rather than write NaN for a half-typed poll timeout', () => {
      // The schema reports the error; the config must stay a shape the backend
      // would accept if the operator saved mid-edit.
      expect(
        applyToConfig({ statusPollTimeoutMs: 45000 }, { eparagonyStatusPollTimeoutMs: '-' }),
      ).toEqual({ statusPollTimeoutMs: null });
    });

    it('should clear rather than write a non-positive poll timeout the backend would refuse', () => {
      for (const typed of ['0', '-5']) {
        expect(applyToConfig({}, { eparagonyStatusPollTimeoutMs: typed })).toEqual({
          statusPollTimeoutMs: null,
        });
      }
    });

    it('should keep a decimal poll timeout intact rather than silently truncating it', () => {
      // `Number.parseInt('1000.5')` is 1000 and `parseInt('12abc')` is 12 - both
      // would write a number the operator never typed. The backend accepts any
      // positive finite number, so a decimal is preserved and a partial value is
      // refused outright.
      expect(applyToConfig({}, { eparagonyStatusPollTimeoutMs: '1000.5' })).toEqual({
        statusPollTimeoutMs: 1000.5,
      });
      expect(applyToConfig({}, { eparagonyStatusPollTimeoutMs: '12abc' })).toEqual({
        statusPollTimeoutMs: null,
      });
    });

    it('should trim a text leaf and clear it to null when emptied', () => {
      expect(applyToConfig({}, { eparagonyPaymentName: '  Visa  ' })).toEqual({
        paymentName: 'Visa',
      });
      expect(applyToConfig({ paymentName: 'Visa' }, { eparagonyPaymentName: '   ' })).toEqual({
        paymentName: null,
      });
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
      expect(schemaShape.eparagonyStatusPollTimeoutMs?.safeParse('-5').success).toBe(false);
    });

    it('should accept a stored decimal poll timeout, which the backend treats as valid', () => {
      // The resolver is FORM-WIDE, so an integer-only rule would let one legal
      // persisted value (`statusPollTimeoutMs: 1000.5`, which the validator
      // accepts) block every unrelated edit on the connection until the operator
      // retyped a field they may never have set (#3268 review).
      expect(schemaShape.eparagonyStatusPollTimeoutMs?.safeParse('1000.5').success).toBe(true);
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
