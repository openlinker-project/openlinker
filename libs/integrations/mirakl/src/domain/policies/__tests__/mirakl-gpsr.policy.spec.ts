/**
 * Mirakl GPSR Policy: unit tests
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import { buildMiraklGpsrFields } from '../mirakl-gpsr.policy';

describe('buildMiraklGpsrFields', () => {
  it('should map the responsible person and the producer onto the Empik fields', () => {
    expect(
      buildMiraklGpsrFields({
        responsiblePerson: {
          name: 'Importer Sp. z o.o.',
          email: 'gpsr@example.com',
          address: {
            street: 'ul. Prosta 1',
            city: 'Warszawa',
            postalCode: '00-001',
            countryCode: 'PL',
          },
        },
        producer: { name: 'Maker GmbH', phone: '+49 30 123' },
      })
    ).toEqual([
      { code: 'gpsr-entity-name', value: 'Importer Sp. z o.o.' },
      { code: 'gpsr-address', value: 'ul. Prosta 1' },
      { code: 'gpsr-city', value: 'Warszawa' },
      { code: 'gpsr-zip-code', value: '00-001' },
      { code: 'gpsr-country', value: 'PL' },
      { code: 'gpsr-email', value: 'gpsr@example.com' },
      { code: 'gpsr-manufacturer-entity-name', value: 'Maker GmbH' },
      { code: 'gpsr-manufacturer-phone', value: '+49 30 123' },
    ]);
  });

  it('should fall back to the importer when no responsible person is given', () => {
    expect(buildMiraklGpsrFields({ importer: { name: 'Importer' } })).toEqual([
      { code: 'gpsr-entity-name', value: 'Importer' },
    ]);
  });

  it('should send nothing when the master gave no GPSR data', () => {
    expect(buildMiraklGpsrFields(undefined)).toEqual([]);
  });
});
