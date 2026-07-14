/**
 * FA(3) Structural Validator — Unit Specs
 *
 * Specs for the structural / well-formedness gate: a well-formed FA(3) document
 * passes; a malformed one throws `Fa3XsdValidationException` with diagnostic
 * issues; the raw XML is never echoed into the exception message (PII safety).
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/validators
 */
import { buildFa3Xml } from '../builders/fa3-xml.builder';
import { Fa3XsdValidationException } from '../../../domain/exceptions/fa3-validation.exception';
import type { Fa3BuilderInput, RawFa3Xml, SellerProfile } from '../domain/fa3-xml.types';
import { validateFa3Xml } from './fa3-xsd.validator';

// Well-formed but structurally incomplete: a bare root + empty Naglowek. The
// hardened rule set must reject it for the missing required sections.
const wellFormedButIncomplete = (`<?xml version="1.0" encoding="UTF-8"?>` +
  `<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">` +
  `<Naglowek/></Faktura>`) as RawFa3Xml;

const seller: SellerProfile = {
  nip: '1234567890',
  name: 'Acme Sp. z o.o.',
  address: { line1: 'ul. Testowa 1', line2: null, city: 'Warszawa', postalCode: '00-001', countryIso2: 'PL' },
};

function builtDoc(payment?: Fa3BuilderInput['payment']): RawFa3Xml {
  const input: Fa3BuilderInput = {
    seller,
    buyer: { kind: 'nip', nip: '9876543210' },
    buyerName: 'Buyer GmbH',
    buyerAddress: { line1: 'Main St 5', line2: null, city: 'Berlin', postalCode: '10115', countryIso2: 'DE' },
    currency: 'PLN',
    issueDate: '2026-06-23',
    invoiceNumber: 'FV/2026/06/0001',
    generatedAt: '2026-06-23T10:15:30Z',
    lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 123.45, p12: '23' }],
    ...(payment !== undefined ? { payment } : {}),
  };
  return buildFa3Xml(input);
}

const fullPayment: Fa3BuilderInput['payment'] = {
  formaPlatnosci: '6',
  bankAccount: { nrRb: '61109010140000000099999999', bankName: 'Santander', swift: 'WBKPPLPP' },
  paymentTermDays: 14,
  skonto: { conditions: '2% at 7 days', amount: '2%' },
};

describe('validateFa3Xml', () => {
  it('should return normally for a document produced by the builder', () => {
    expect(() => validateFa3Xml(builtDoc())).not.toThrow();
  });

  it('should reject a well-formed but structurally incomplete document', () => {
    try {
      validateFa3Xml(wellFormedButIncomplete);
      fail('expected Fa3XsdValidationException');
    } catch (error) {
      expect(error).toBeInstanceOf(Fa3XsdValidationException);
      const paths = (error as Fa3XsdValidationException).issues.map((i) => i.path);
      // The missing Fa body + its required children must be flagged.
      expect(paths).toContain('/Faktura/Fa');
      expect(paths).toContain('/Faktura/Podmiot1/DaneIdentyfikacyjne');
    }
  });

  it('should throw Fa3XsdValidationException with issues for an invalid document', () => {
    const bad = '<Faktura><unclosed></Faktura>' as RawFa3Xml;
    try {
      validateFa3Xml(bad);
      fail('expected Fa3XsdValidationException');
    } catch (error) {
      expect(error).toBeInstanceOf(Fa3XsdValidationException);
      expect((error as Fa3XsdValidationException).issues.length).toBeGreaterThan(0);
    }
  });

  it('should reject a P_12 value outside the TStawkaPodatku token set', () => {
    // A stale bare `np` (KSeF only knows `np I` / `np II`) must be caught.
    const bad = builtDoc().replace(/<P_12>[^<]*<\/P_12>/, '<P_12>np</P_12>') as RawFa3Xml;
    try {
      validateFa3Xml(bad);
      fail('expected Fa3XsdValidationException');
    } catch (error) {
      expect(error).toBeInstanceOf(Fa3XsdValidationException);
      const paths = (error as Fa3XsdValidationException).issues.map((i) => i.path);
      expect(paths).toContain('/Faktura/Fa/FaWiersz/P_12');
    }
  });

  it('should reject a KodWaluty outside the supported currency set', () => {
    const bad = builtDoc().replace('<KodWaluty>PLN</KodWaluty>', '<KodWaluty>XYZ</KodWaluty>') as RawFa3Xml;
    try {
      validateFa3Xml(bad);
      fail('expected Fa3XsdValidationException');
    } catch (error) {
      expect(error).toBeInstanceOf(Fa3XsdValidationException);
      const paths = (error as Fa3XsdValidationException).issues.map((i) => i.path);
      expect(paths).toContain('/Faktura/Fa/KodWaluty');
    }
  });

  it('should accept the np II token (a valid TStawkaPodatku value)', () => {
    // Swapping the P_12 value for a valid token keeps the document otherwise
    // valid; the token guard must NOT reject `np II`.
    const doc = builtDoc().replace(/<P_12>[^<]*<\/P_12>/, '<P_12>np II</P_12>') as RawFa3Xml;
    expect(() => validateFa3Xml(doc)).not.toThrow();
  });

  it('should accept a builder-produced document with a fully-configured Platnosc', () => {
    expect(() => validateFa3Xml(builtDoc(fullPayment))).not.toThrow();
  });

  it('should reject a Platnosc whose FormaPlatnosci precedes TerminPlatnosci', () => {
    // Simulate the pre-#1317 "method-first" ordering bug by swapping the two
    // leading Platnosc children in a builder-produced document.
    const doc = builtDoc(fullPayment);
    const bad = doc.replace(
      /(<TerminPlatnosci>[^]*?<\/TerminPlatnosci>)(<FormaPlatnosci>[^<]*<\/FormaPlatnosci>)/,
      '$2$1',
    ) as RawFa3Xml;
    expect(bad).not.toEqual(doc);
    try {
      validateFa3Xml(bad);
      fail('expected Fa3XsdValidationException');
    } catch (error) {
      expect(error).toBeInstanceOf(Fa3XsdValidationException);
      const paths = (error as Fa3XsdValidationException).issues.map((i) => i.path);
      expect(paths).toContain('/Faktura/Fa/Platnosc/FormaPlatnosci');
    }
  });

  it('should reject a RachunekBankowy that emits NazwaBanku before SWIFT (the PR #1317 blocker shape)', () => {
    const doc = builtDoc(fullPayment);
    const bad = doc.replace(
      /(<SWIFT>[^<]*<\/SWIFT>)(<NazwaBanku>[^<]*<\/NazwaBanku>)/,
      '$2$1',
    ) as RawFa3Xml;
    expect(bad).not.toEqual(doc);
    try {
      validateFa3Xml(bad);
      fail('expected Fa3XsdValidationException');
    } catch (error) {
      expect(error).toBeInstanceOf(Fa3XsdValidationException);
      const paths = (error as Fa3XsdValidationException).issues.map((i) => i.path);
      // The canonically-later element (`NazwaBanku`) is the one found out of
      // place, so the issue is anchored to it.
      expect(paths).toContain('/Faktura/Fa/Platnosc/RachunekBankowy/NazwaBanku');
    }
  });

  it('should reject a RachunekBankowy without NrRB', () => {
    const doc = builtDoc(fullPayment);
    const bad = doc.replace(/<NrRB>[^<]*<\/NrRB>/, '') as RawFa3Xml;
    expect(bad).not.toEqual(doc);
    try {
      validateFa3Xml(bad);
      fail('expected Fa3XsdValidationException');
    } catch (error) {
      expect(error).toBeInstanceOf(Fa3XsdValidationException);
      const paths = (error as Fa3XsdValidationException).issues.map((i) => i.path);
      expect(paths).toContain('/Faktura/Fa/Platnosc/RachunekBankowy/NrRB');
    }
  });

  it('should reject a P_6 emitted after the P_13_x aggregates (#1525 Fa-order guard)', () => {
    // Simulate a builder regression by moving P_6 after P_13_1 in a valid doc.
    const withSaleDate = buildFa3Xml({
      seller,
      buyer: { kind: 'nip', nip: '9876543210' },
      buyerName: 'Buyer GmbH',
      buyerAddress: { line1: 'Main St 5', line2: null, city: 'Berlin', postalCode: '10115', countryIso2: 'DE' },
      currency: 'PLN',
      issueDate: '2026-06-23',
      invoiceNumber: 'FV/2026/06/0001',
      generatedAt: '2026-06-23T10:15:30Z',
      saleDate: '2026-06-20',
      lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 123.45, p12: '23' }],
    });
    const bad = withSaleDate.replace(
      /(<P_6>[^<]*<\/P_6>)(<P_13_1>[^<]*<\/P_13_1>)/,
      '$2$1',
    ) as RawFa3Xml;
    expect(bad).not.toEqual(withSaleDate);
    try {
      validateFa3Xml(bad);
      fail('expected Fa3XsdValidationException');
    } catch (error) {
      expect(error).toBeInstanceOf(Fa3XsdValidationException);
      const paths = (error as Fa3XsdValidationException).issues.map((i) => i.path);
      expect(paths).toContain('/Faktura/Fa/P_13_1');
    }
  });

  it('should reject a FaWiersz that emits P_8A after P_8B (#1525 ordering guard)', () => {
    const input: Fa3BuilderInput = {
      seller,
      buyer: { kind: 'nip', nip: '9876543210' },
      buyerName: 'Buyer GmbH',
      buyerAddress: { line1: 'Main St 5', line2: null, city: 'Berlin', postalCode: '10115', countryIso2: 'DE' },
      currency: 'PLN',
      issueDate: '2026-06-23',
      invoiceNumber: 'FV/2026/06/0001',
      generatedAt: '2026-06-23T10:15:30Z',
      lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 123.45, p12: '23', unit: 'szt.' }],
    };
    const doc = buildFa3Xml(input);
    const bad = doc.replace(
      /(<P_8A>[^<]*<\/P_8A>)(<P_8B>[^<]*<\/P_8B>)/,
      '$2$1',
    ) as RawFa3Xml;
    expect(bad).not.toEqual(doc);
    try {
      validateFa3Xml(bad);
      fail('expected Fa3XsdValidationException');
    } catch (error) {
      expect(error).toBeInstanceOf(Fa3XsdValidationException);
      const paths = (error as Fa3XsdValidationException).issues.map((i) => i.path);
      expect(paths).toContain('/Faktura/Fa/FaWiersz/P_8B');
    }
  });

  it('should not embed the raw XML in the exception message', () => {
    const bad = '<Faktura>SECRET_BUYER_NAME</Faktura>' as RawFa3Xml;
    try {
      validateFa3Xml(bad);
      fail('expected Fa3XsdValidationException');
    } catch (error) {
      expect((error as Fa3XsdValidationException).message).not.toContain('SECRET_BUYER_NAME');
    }
  });
});
