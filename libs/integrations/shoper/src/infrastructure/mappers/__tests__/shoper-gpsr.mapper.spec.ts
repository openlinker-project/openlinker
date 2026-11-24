/**
 * Shoper GPSR Mapper - unit tests
 *
 * The rules that decide what a product's `safety_information` means: an absent
 * block is unknown, an all-empty block is "none", and an unresolvable reference
 * makes the whole answer unknown rather than partial.
 */
import type { ShoperSafetyPartyRecord } from '../../../domain/types/shoper-api.types';
import {
  buildShoperGpsr,
  mapShoperGpsrParty,
  readShoperGpsrReferences,
  shoperGpsrId,
} from '../shoper-gpsr.mapper';

const PRODUCER: ShoperSafetyPartyRecord = {
  gpsr_producer_id: '3',
  name: 'Acme Sp. z o.o.',
  internal_name: 'acme (do not print)',
  email: 'safety@acme.example',
  phone: '+48 600 000 000',
  contact_form_url: 'https://acme.example/contact',
  street1: 'Prosta 1',
  street2: 'lok. 2',
  postcode: '00-001',
  city: 'Warszawa',
  country_code: 'pl',
};

describe('shoper-gpsr.mapper', () => {
  describe('shoperGpsrId', () => {
    it('should normalise string and number ids and read zero, blanks and junk as unset', () => {
      expect(shoperGpsrId('7')).toBe('7');
      expect(shoperGpsrId(7)).toBe('7');
      expect(shoperGpsrId('007')).toBe('7');
      expect(shoperGpsrId('0')).toBeNull();
      expect(shoperGpsrId(0)).toBeNull();
      expect(shoperGpsrId('')).toBeNull();
      expect(shoperGpsrId(null)).toBeNull();
      expect(shoperGpsrId('abc')).toBeNull();
    });
  });

  describe('readShoperGpsrReferences', () => {
    it('should answer undefined when the payload carries no safety_information', () => {
      expect(readShoperGpsrReferences(undefined)).toBeUndefined();
      expect(readShoperGpsrReferences(null)).toBeUndefined();
    });

    it('should answer null when every reference is empty', () => {
      expect(
        readShoperGpsrReferences({
          gpsr_producer_id: null,
          gpsr_responsible_id: null,
          gpsr_importer_id: null,
          gpsr_certificates: [],
        }),
      ).toBeNull();
    });

    it('should normalise and de-duplicate the references when some are set', () => {
      expect(
        readShoperGpsrReferences({
          gpsr_producer_id: '3',
          gpsr_responsible_id: null,
          gpsr_importer_id: 5,
          gpsr_certificates: [1, '1', 2],
        }),
      ).toEqual({ producerId: '3', responsibleId: null, importerId: '5', certificateIds: ['1', '2'] });
    });
  });

  describe('mapShoperGpsrParty', () => {
    it('should map the public name, contact and address and never the internal name', () => {
      expect(mapShoperGpsrParty(PRODUCER)).toEqual({
        name: 'Acme Sp. z o.o.',
        email: 'safety@acme.example',
        phone: '+48 600 000 000',
        contactUrl: 'https://acme.example/contact',
        address: { street: 'Prosta 1, lok. 2', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' },
      });
    });

    it('should return null when the record has no public name', () => {
      expect(mapShoperGpsrParty({ ...PRODUCER, name: '  ' })).toBeNull();
    });

    it('should drop a city that is a subregion id and a country that is not a two-letter code', () => {
      const party = mapShoperGpsrParty({ ...PRODUCER, city: '1234', country_code: 'Poland' });

      expect(party?.address).toEqual({ street: 'Prosta 1, lok. 2', postalCode: '00-001' });
    });
  });

  describe('buildShoperGpsr', () => {
    const refs = { producerId: '3', responsibleId: null, importerId: null, certificateIds: ['9'] };

    it('should resolve parties and certificate names when every reference is known', () => {
      const outcome = buildShoperGpsr(refs, {
        producers: new Map([['3', PRODUCER]]),
        certificates: new Map([
          ['9', { gpsr_certificate_id: '9', name: 'CE', translations: { pl_PL: { description: 'Opis CE' } } }],
        ]),
      });

      expect(outcome).toEqual({
        kind: 'resolved',
        gpsr: {
          producer: expect.objectContaining({ name: 'Acme Sp. z o.o.' }),
          // A certificate description describes the certificate, so it never
          // becomes the product's safety text.
          safetyInformation: { certificateNames: ['CE'] },
        },
      });
    });

    it('should be unresolvable when a referenced record is missing from the registry', () => {
      const outcome = buildShoperGpsr(refs, {
        producers: new Map(),
        certificates: new Map([['9', { name: 'CE' }]]),
      });

      expect(outcome).toEqual({ kind: 'unresolvable', detail: "producer 3 is not in the shop's registry" });
    });

    it('should be unresolvable rather than partial when a record has no public name', () => {
      const outcome = buildShoperGpsr(
        { ...refs, certificateIds: [] },
        { producers: new Map([['3', { ...PRODUCER, name: null }]]) },
      );

      expect(outcome.kind).toBe('unresolvable');
    });
  });
});
