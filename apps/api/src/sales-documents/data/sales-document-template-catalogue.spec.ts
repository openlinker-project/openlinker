/**
 * Sales-Document Starter-Template Catalogue Specs (#2529)
 *
 * Pins the two properties the settings surface depends on: the catalogue is
 * country-keyed data with a citable source, and the ABSENCE of a template is
 * a reportable answer rather than an empty template a surface could render as
 * guidance.
 *
 * @module apps/api/src/sales-documents/data
 */
import {
  getSalesDocumentStarterTemplate,
  hasSalesDocumentStarterTemplate,
  listSalesDocumentTemplateCountries,
  SALES_DOCUMENT_TEMPLATE_PROVENANCE_BY_COUNTRY,
} from './sales-document-template-catalogue';

describe('sales-document starter-template catalogue', () => {
  describe('listSalesDocumentTemplateCountries', () => {
    it('should list Poland as the only researched market when read', () => {
      expect(listSalesDocumentTemplateCountries().map((entry) => entry.country)).toEqual(['PL']);
    });

    it('should carry a citable source for every listed market when read', () => {
      for (const entry of listSalesDocumentTemplateCountries()) {
        expect(entry.sourceLabel.length).toBeGreaterThan(0);
        expect(entry.sourceUrl).toMatch(/^https:\/\//);
      }
    });
  });

  describe('getSalesDocumentStarterTemplate', () => {
    it('should report absence as null when the country has no researched guidance', () => {
      expect(getSalesDocumentStarterTemplate('DE')).toBeNull();
      expect(hasSalesDocumentStarterTemplate('DE')).toBe(false);
    });

    it('should never report absence as an empty template when the country has none', () => {
      const template = getSalesDocumentStarterTemplate('CZ');
      // An empty-but-present template would let a surface render "suggested
      // setup" with nothing in it, which claims guidance that does not exist.
      expect(template).toBeNull();
    });

    it('should resolve a lower-case country code when the caller passes one', () => {
      expect(getSalesDocumentStarterTemplate('pl')?.country).toBe('PL');
      expect(hasSalesDocumentStarterTemplate('pl')).toBe(true);
    });

    it('should carry the rule shapes and their required capability when Poland is read', () => {
      const template = getSalesDocumentStarterTemplate('PL');
      expect(template).not.toBeNull();
      // #3189 changed this list in two ways. `no-tax-id` is GONE: it matched
      // `buyerHasTaxId === false`, which is reachable only from a positively
      // asserted "has none", and no source adapter can produce that state - so
      // the flagship template shipped a rule that was dead on every install.
      // And the threshold pair is now per CURRENCY, because an inline amount is
      // compared and never converted: PL's simplified-invoice ceiling is 450 PLN
      // OR 100 EUR, which under that rule is two rules rather than one.
      expect(template?.rules.map((rule) => rule.slot)).toEqual([
        'tax-id-below-threshold',
        'tax-id-above-threshold',
        'tax-id-below-threshold-eur',
        'tax-id-above-threshold-eur',
      ]);
      for (const rule of template?.rules ?? []) {
        expect(['Invoicing', 'Fiscalization']).toContain(rule.requiredCapability);
      }
    });

    it('should carry a provenance tag for every listed market when adopted rows are written', () => {
      for (const entry of listSalesDocumentTemplateCountries()) {
        expect(SALES_DOCUMENT_TEMPLATE_PROVENANCE_BY_COUNTRY[entry.country]).toBeDefined();
      }
    });
  });
});
