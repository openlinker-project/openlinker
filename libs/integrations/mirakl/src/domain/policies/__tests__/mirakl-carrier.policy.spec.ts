/**
 * Mirakl Carrier Policy: unit tests
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import { buildMiraklTrackingBody, resolveMiraklCarrierCode } from '../mirakl-carrier.policy';

describe('resolveMiraklCarrierCode', () => {
  it('should send an InPost parcel-locker order as paczkomatyinpost', () => {
    expect(
      resolveMiraklCarrierCode({ platformType: 'inpost', shippingTypeCode: 'PACKSTATION_POD' })
    ).toBe('paczkomatyinpost');
  });

  it('should send any other InPost order as the InPost courier', () => {
    expect(resolveMiraklCarrierCode({ platformType: 'inpost', shippingTypeCode: 'COURIER' })).toBe(
      'inpostpaczkakurierska'
    );
  });

  it('should use the built-in table for a known carrier', () => {
    expect(resolveMiraklCarrierCode({ platformType: 'DPD' })).toBe('dpd');
  });

  it('should let the connection override win over the table', () => {
    expect(
      resolveMiraklCarrierCode({
        platformType: 'inpost',
        shippingTypeCode: 'PACKSTATION',
        overrides: { inpost: 'tw' },
      })
    ).toBe('tw');
  });

  it('should return nothing for an unknown carrier or no hint', () => {
    expect(resolveMiraklCarrierCode({ platformType: 'acme-express' })).toBeUndefined();
    expect(resolveMiraklCarrierCode({})).toBeUndefined();
  });
});

describe('buildMiraklTrackingBody', () => {
  it('should send a known carrier by code', () => {
    expect(buildMiraklTrackingBody('TRK1', { platformType: 'dpd' })).toEqual({
      carrier_code: 'dpd',
      tracking_number: 'TRK1',
    });
  });

  it('should send an unknown carrier by name', () => {
    expect(buildMiraklTrackingBody('TRK1', { platformType: 'acme-express' })).toEqual({
      carrier_name: 'acme-express',
      tracking_number: 'TRK1',
    });
  });

  it('should fall back to a generic name with no hint', () => {
    expect(buildMiraklTrackingBody('TRK1', {})).toEqual({
      carrier_name: 'Carrier',
      tracking_number: 'TRK1',
    });
  });
});
