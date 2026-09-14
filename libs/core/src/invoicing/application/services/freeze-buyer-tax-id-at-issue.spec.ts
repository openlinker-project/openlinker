/**
 * `freezeBuyerTaxIdAtIssue` — unit tests (#3188)
 *
 * The rule that decides what `invoice_records.buyerTaxId` holds. It is pure and
 * module-scoped precisely so it can be pinned here rather than through a whole
 * issuance, because the property that matters is a NEGATIVE one: the frozen
 * value must never claim more than the issued document does.
 *
 * @module libs/core/src/invoicing/application/services
 */
import { BuyerProfile } from '../../domain/entities/buyer-profile.entity';
import type {
  BuyerAddress,
  IssueInvoiceCommand,
  TaxIdentifier,
} from '../../domain/types/invoicing.types';
import { freezeBuyerTaxIdAtIssue } from './invoice.service';

const ADDRESS: BuyerAddress = {
  line1: 'Testowa 1',
  line2: null,
  city: 'Warszawa',
  postalCode: '00-001',
  countryIso2: 'PL',
};

function command(taxId: TaxIdentifier | null, assertion?: string | null): IssueInvoiceCommand {
  const cmd: IssueInvoiceCommand = {
    connectionId: 'conn-1',
    orderId: 'ol_order_1',
    buyer: new BuyerProfile('Acme Sp. z o.o.', taxId, ADDRESS, taxId ? 'company' : 'private'),
    currency: 'PLN',
    lines: [],
  };
  if (assertion !== undefined) {
    cmd.buyerTaxIdAssertion = assertion;
  }
  return cmd;
}

describe('freezeBuyerTaxIdAtIssue', () => {
  it('freezes the id the document carries', () => {
    expect(freezeBuyerTaxIdAtIssue(command({ value: '5213796333' }))).toBe('5213796333');
  });

  it('freezes a TAGGED id the same way - the tag is the adapter concern, not the projection one', () => {
    expect(freezeBuyerTaxIdAtIssue(command({ scheme: 'pl-nip', value: '5213796333' }))).toBe(
      '5213796333',
    );
  });

  it('trims the frozen id', () => {
    expect(freezeBuyerTaxIdAtIssue(command({ value: '  5213796333  ' }))).toBe('5213796333');
  });

  // The two ABSENCES are what the third rendering exists for, and they decide
  // different fiscal documents upstream, so they must not collapse here.
  it('records a positively-asserted "buyer has none" as the asserted-none state', () => {
    expect(freezeBuyerTaxIdAtIssue(command(null, ''))).toBe('');
  });

  it('records an absent assertion as not-asserted', () => {
    expect(freezeBuyerTaxIdAtIssue(command(null))).toBeNull();
  });

  it('records an explicitly-null assertion as not-asserted', () => {
    expect(freezeBuyerTaxIdAtIssue(command(null, null))).toBeNull();
  });

  // THE load-bearing property. An operator issuing by hand without a tax id,
  // against an order that has one, must not produce a list row showing a number
  // the document does not carry.
  it('NEVER claims an id the document does not carry', () => {
    expect(freezeBuyerTaxIdAtIssue(command(null, '5213796333'))).toBeNull();
  });

  it('treats a blank document id as no id rather than an empty identifier', () => {
    expect(freezeBuyerTaxIdAtIssue(command({ value: '   ' }))).toBeNull();
    expect(freezeBuyerTaxIdAtIssue(command({ value: '   ' }, ''))).toBe('');
  });
});
