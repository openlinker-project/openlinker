import { describe, expect, it } from 'vitest';
import { describeSalesDocumentCountryReset } from './describe-sales-document-country-reset';

describe('describeSalesDocumentCountryReset (#2189)', () => {
  it('names the exact rule count when only rules are present', () => {
    const description = describeSalesDocumentCountryReset('DE', {
      ruleCount: 3,
      hasInvoiceDefault: false,
      hasReceiptDefault: false,
      acknowledged: false,
    });
    expect(description).toBe("This deletes 3 rules for DE. This can't be undone.");
  });

  it('uses the singular noun for exactly one rule', () => {
    const description = describeSalesDocumentCountryReset('DE', {
      ruleCount: 1,
      hasInvoiceDefault: false,
      hasReceiptDefault: false,
      acknowledged: false,
    });
    expect(description).toBe("This deletes 1 rule for DE. This can't be undone.");
  });

  it('names both country defaults distinctly from a single default', () => {
    const bothDefaults = describeSalesDocumentCountryReset('PL', {
      ruleCount: 0,
      hasInvoiceDefault: true,
      hasReceiptDefault: true,
      acknowledged: false,
    });
    expect(bothDefaults).toBe("This deletes both country defaults for PL. This can't be undone.");

    const invoiceOnly = describeSalesDocumentCountryReset('PL', {
      ruleCount: 0,
      hasInvoiceDefault: true,
      hasReceiptDefault: false,
      acknowledged: false,
    });
    expect(invoiceOnly).toBe("This deletes the Invoice default for PL. This can't be undone.");

    const receiptOnly = describeSalesDocumentCountryReset('PL', {
      ruleCount: 0,
      hasInvoiceDefault: false,
      hasReceiptDefault: true,
      acknowledged: false,
    });
    expect(receiptOnly).toBe("This deletes the Receipt default for PL. This can't be undone.");
  });

  it('names the acknowledgment alone when nothing else is set', () => {
    const description = describeSalesDocumentCountryReset('ES', {
      ruleCount: 0,
      hasInvoiceDefault: false,
      hasReceiptDefault: false,
      acknowledged: true,
    });
    expect(description).toBe(
      "This deletes the no-document acknowledgment for ES. This can't be undone.",
    );
  });

  it('joins rules, both defaults, and the acknowledgment with an Oxford comma', () => {
    const description = describeSalesDocumentCountryReset('★ Rest of world', {
      ruleCount: 2,
      hasInvoiceDefault: true,
      hasReceiptDefault: true,
      acknowledged: true,
    });
    expect(description).toBe(
      "This deletes 2 rules, both country defaults, and the no-document acknowledgment for ★ Rest of world. This can't be undone.",
    );
  });

  it('joins exactly two clauses with a plain "and", no comma', () => {
    const description = describeSalesDocumentCountryReset('DE', {
      ruleCount: 2,
      hasInvoiceDefault: true,
      hasReceiptDefault: false,
      acknowledged: false,
    });
    expect(description).toBe(
      "This deletes 2 rules and the Invoice default for DE. This can't be undone.",
    );
  });
});
