/**
 * Invoice Tax-Rate Policy - unit tests (#3192)
 *
 * The invoice vocabulary is a SECOND, unrelated mapping beside the receipt's
 * device-slot letters, so these tests also pin the two properties that keep the
 * two apart: a slot letter is not an invoice rate, and an unresolvable rate
 * blocks rather than falling back to anything.
 *
 * @module libs/integrations/eparagony/src/domain/policies/__tests__
 */
import {
  invoiceTaxRateFraction,
  isInvoiceTaxRateCode,
  isTaxedInvoiceRate,
  resolveInvoiceTaxRateCode,
} from '../invoice-tax-rate.policy';
import { EparagonyInvoiceTaxRateValues } from '../../types/eparagony-api.types';

describe('invoice-tax-rate.policy', () => {
  describe('resolveInvoiceTaxRateCode - percentages', () => {
    it('should resolve each taxed percentage to its own vendor code', () => {
      expect(resolveInvoiceTaxRateCode('23')).toBe('23');
      expect(resolveInvoiceTaxRateCode('8')).toBe('8');
      expect(resolveInvoiceTaxRateCode('5')).toBe('5');
      expect(resolveInvoiceTaxRateCode('3')).toBe('3');
    });

    it('should compare a percentage numerically so formatting cannot change the answer', () => {
      expect(resolveInvoiceTaxRateCode('23.00')).toBe('23');
      expect(resolveInvoiceTaxRateCode('23%')).toBe('23');
      expect(resolveInvoiceTaxRateCode(' 23 ')).toBe('23');
    });

    it('should read a single comma as a decimal point rather than refusing the whole invoice', () => {
      // `Number('23,00')` is `NaN`, which fell through to the exemption lookup
      // and then to a hard refusal, while core's own `parseTaxRatePercent` reads
      // the same value as 23 via `parseFloat`.
      expect(resolveInvoiceTaxRateCode('23,00')).toBe('23');
      expect(resolveInvoiceTaxRateCode('8,0')).toBe('8');
    });

    it('should not read a thousands separator as a decimal comma', () => {
      // Narrow on purpose: one or two digits after the comma. `1,000` is left to
      // fail the rate lookup rather than being read as `1.000`.
      expect(resolveInvoiceTaxRateCode('1,000')).toBeNull();
    });

    it("should resolve a zero rate to the vendor's own stated default zero code", () => {
      // The vendor's contract names ZRD "the default 0%"; a caller that means
      // intra-community supply or export says so with the specific code.
      expect(resolveInvoiceTaxRateCode('0')).toBe('ZRD');
      expect(resolveInvoiceTaxRateCode('0.00')).toBe('ZRD');
    });

    it('should refuse a percentage the regime does not have', () => {
      expect(resolveInvoiceTaxRateCode('7')).toBeNull();
      expect(resolveInvoiceTaxRateCode('19')).toBeNull();
    });
  });

  describe('resolveInvoiceTaxRateCode - exemption markers', () => {
    it('should resolve the neutral exemption markers to their regime codes', () => {
      expect(resolveInvoiceTaxRateCode('zw')).toBe('EP');
      expect(resolveInvoiceTaxRateCode('oo')).toBe('RCP');
      expect(resolveInvoiceTaxRateCode('np')).toBe('NS1');
    });

    it('should resolve a marker whatever case it arrives in', () => {
      expect(resolveInvoiceTaxRateCode('ZW')).toBe('EP');
      expect(resolveInvoiceTaxRateCode('Oo')).toBe('RCP');
    });

    it('should refuse a marker that names no regime code', () => {
      expect(resolveInvoiceTaxRateCode('exempt')).toBeNull();
      expect(resolveInvoiceTaxRateCode('reverse-charge')).toBeNull();
    });
  });

  describe('resolveInvoiceTaxRateCode - vendor codes pass through', () => {
    it('should accept every vendor code verbatim', () => {
      // This is the escape hatch that makes the two defaults above safe: the
      // distinctions the neutral vocabulary cannot express (domestic zero rate
      // against intra-community supply against export, procedure I against II)
      // are still reachable by naming the code.
      for (const code of EparagonyInvoiceTaxRateValues) {
        expect(resolveInvoiceTaxRateCode(code)).toBe(code);
      }
    });

    it('should accept a vendor code in lower case', () => {
      expect(resolveInvoiceTaxRateCode('zrics')).toBe('ZRICS');
      expect(resolveInvoiceTaxRateCode('ns2')).toBe('NS2');
    });
  });

  describe('resolveInvoiceTaxRateCode - refusals', () => {
    it('should refuse an empty rate rather than substituting one', () => {
      // There is no `defaultTaxRateCode` equivalent on this path: that setting
      // describes the seller's DEVICE, and an invoice has none. Substituting
      // here would be OpenLinker choosing a rate for a document the seller is
      // answerable for.
      expect(resolveInvoiceTaxRateCode('')).toBeNull();
      expect(resolveInvoiceTaxRateCode('   ')).toBeNull();
    });

    it('should refuse fractional notation rather than reinterpreting it', () => {
      // `0.23` read as a percentage is 0.23%, and nothing in the value says
      // which the writer meant (#2247). Refusing surfaces as a pre-call block.
      expect(resolveInvoiceTaxRateCode('0.23')).toBeNull();
      expect(resolveInvoiceTaxRateCode('0.08')).toBeNull();
    });

    it('should refuse a receipt device-slot letter, which is a different vocabulary', () => {
      // `A` is the slot a device has 23% programmed into, not the rate itself.
      // Accepting it here would silently invoice at whatever the device says.
      expect(resolveInvoiceTaxRateCode('A')).toBeNull();
      expect(resolveInvoiceTaxRateCode('B')).toBeNull();
      expect(resolveInvoiceTaxRateCode('G')).toBeNull();
    });

    it('should refuse a bare percent sign rather than reading it as a zero rate', () => {
      // `Number('')` is `0`, so stripping the sign first without checking what
      // is left would turn this into a zero-rated line.
      expect(resolveInvoiceTaxRateCode('%')).toBeNull();
    });
  });

  describe('invoiceTaxRateFraction', () => {
    it('should give each taxed code its own fraction of one', () => {
      expect(invoiceTaxRateFraction('23')).toBeCloseTo(0.23, 10);
      expect(invoiceTaxRateFraction('8')).toBeCloseTo(0.08, 10);
      expect(invoiceTaxRateFraction('5')).toBeCloseTo(0.05, 10);
      expect(invoiceTaxRateFraction('3')).toBeCloseTo(0.03, 10);
    });

    it('should give every zero-rate and out-of-scope code a zero fraction', () => {
      expect(invoiceTaxRateFraction('ZRD')).toBe(0);
      expect(invoiceTaxRateFraction('ZRICS')).toBe(0);
      expect(invoiceTaxRateFraction('ZRE')).toBe(0);
      expect(invoiceTaxRateFraction('EP')).toBe(0);
      expect(invoiceTaxRateFraction('RCP')).toBe(0);
      expect(invoiceTaxRateFraction('NS1')).toBe(0);
      expect(invoiceTaxRateFraction('NS2')).toBe(0);
    });

    it('should carry a fraction for every declared code, so no code can be added without one', () => {
      for (const code of EparagonyInvoiceTaxRateValues) {
        expect(Number.isFinite(invoiceTaxRateFraction(code))).toBe(true);
      }
    });
  });

  describe('isTaxedInvoiceRate', () => {
    it('should admit only the four percentages, because only they may key taxValueByTaxRate', () => {
      // The vendor's two summary maps declare DIFFERENT key sets: all eleven
      // codes for net, only the percentages for tax.
      expect(isTaxedInvoiceRate('23')).toBe(true);
      expect(isTaxedInvoiceRate('3')).toBe(true);
      expect(isTaxedInvoiceRate('ZRD')).toBe(false);
      expect(isTaxedInvoiceRate('EP')).toBe(false);
      expect(isTaxedInvoiceRate('NS2')).toBe(false);
    });

    it('should agree with the fraction table: a taxed code is exactly a non-zero one', () => {
      for (const code of EparagonyInvoiceTaxRateValues) {
        expect(isTaxedInvoiceRate(code)).toBe(invoiceTaxRateFraction(code) > 0);
      }
    });
  });

  describe('isInvoiceTaxRateCode', () => {
    it('should recognise a vendor code and reject anything else', () => {
      expect(isInvoiceTaxRateCode('ZRICS')).toBe(true);
      expect(isInvoiceTaxRateCode('zrics')).toBe(false);
      expect(isInvoiceTaxRateCode('A')).toBe(false);
      expect(isInvoiceTaxRateCode('')).toBe(false);
    });
  });
});
