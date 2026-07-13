/**
 * PickupPointResponseDto Unit Tests
 *
 * Tests the fromDomain() projection of the `PickupPoint` domain value,
 * including the point-type classification fields added in #1433.
 *
 * @module apps/api/src/shipping/http/dto
 */
import type { PickupPoint } from '@openlinker/core/shipping';
import { PickupPointResponseDto } from './pickup-point-response.dto';

function baseDomainPoint(overrides: Partial<PickupPoint> = {}): PickupPoint {
  return {
    providerId: 'POZ08A',
    name: 'POZ08A',
    address: { line1: 'ul. Testowa 1', city: 'Poznań', postalCode: '60-001', country: 'PL' },
    status: 'active',
    ...overrides,
  };
}

describe('PickupPointResponseDto', () => {
  describe('fromDomain', () => {
    it('should project core fields when mapping a domain pickup point', () => {
      const dto = PickupPointResponseDto.fromDomain(baseDomainPoint({ lat: 52.4, lon: 16.9 }));

      expect(dto.providerId).toBe('POZ08A');
      expect(dto.name).toBe('POZ08A');
      expect(dto.address).toEqual({
        line1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
      });
      expect(dto.status).toBe('active');
      expect(dto.lat).toBe(52.4);
      expect(dto.lon).toBe(16.9);
    });

    it('should project pointType and raw type when the domain point classifies as a PaczkoPunkt', () => {
      const dto = PickupPointResponseDto.fromDomain(
        baseDomainPoint({ pointType: 'pop', type: ['parcel_locker', 'pop'] }),
      );

      expect(dto.pointType).toBe('pop');
      expect(dto.type).toEqual(['parcel_locker', 'pop']);
    });

    it('should project pointType apm and raw type when the domain point classifies as a Paczkomat', () => {
      const dto = PickupPointResponseDto.fromDomain(
        baseDomainPoint({ pointType: 'apm', type: ['parcel_locker'] }),
      );

      expect(dto.pointType).toBe('apm');
      expect(dto.type).toEqual(['parcel_locker']);
    });

    it('should leave pointType and type undefined when the domain point carries no classification', () => {
      const dto = PickupPointResponseDto.fromDomain(baseDomainPoint());

      expect(dto.pointType).toBeUndefined();
      expect(dto.type).toBeUndefined();
    });
  });
});
