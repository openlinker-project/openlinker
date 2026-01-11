/**
 * Order Customer Projection Updater Service Unit Tests
 *
 * Unit tests for OrderCustomerProjectionUpdaterService, verifying address projection
 * creation, PII toggle behavior, and billing vs shipping address handling.
 *
 * @module libs/core/src/customers/application/services
 */
import { Test, TestingModule } from '@nestjs/testing';
import { OrderCustomerProjectionUpdaterService } from './order-customer-projection-updater.service';
import { ICustomerProjectionService } from '../interfaces/customer-projection.service.interface';
import { Order } from '@openlinker/core/orders';
import { CUSTOMER_PROJECTION_SERVICE_TOKEN } from '../interfaces/customer-projection.service.interface';
import { CustomerAddressProjection } from '../../domain/entities/customer-address-projection.entity';

describe('OrderCustomerProjectionUpdaterService', () => {
  let service: OrderCustomerProjectionUpdaterService;
  let customerProjectionService: jest.Mocked<ICustomerProjectionService>;

  const originalEnv = process.env.OL_STORE_PII;
  const originalPiiHashSalt = process.env.OL_PII_HASH_SALT;

  beforeEach(async () => {
    // Set required environment variable for PII config
    process.env.OL_PII_HASH_SALT = 'test-salt-for-hashing';
    customerProjectionService = {
      upsertProjection: jest.fn(),
      upsertAddressProjection: jest.fn(),
      upsertDestinationAddressMapping: jest.fn(),
    } as unknown as jest.Mocked<ICustomerProjectionService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderCustomerProjectionUpdaterService,
        {
          provide: CUSTOMER_PROJECTION_SERVICE_TOKEN,
          useValue: customerProjectionService,
        },
      ],
    }).compile();

    service = module.get<OrderCustomerProjectionUpdaterService>(OrderCustomerProjectionUpdaterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (originalEnv) {
      process.env.OL_STORE_PII = originalEnv;
    } else {
      delete process.env.OL_STORE_PII;
    }
    if (originalPiiHashSalt) {
      process.env.OL_PII_HASH_SALT = originalPiiHashSalt;
    } else {
      delete process.env.OL_PII_HASH_SALT;
    }
  });

  const createOrder = (overrides?: Partial<Order>): Order => {
    return {
      id: 'order-123',
      orderNumber: 'ORD-001',
      customerId: 'internal-customer-456',
      items: [],
      totals: {
        subtotal: 100.0,
        tax: 0.0,
        shipping: 0.0,
        total: 100.0,
        currency: 'PLN',
      },
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      shippingAddress: {
        address1: '123 Main St',
        address2: 'Apt 4',
        city: 'Warsaw',
        postalCode: '00-001',
        country: 'PL',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+48123456789',
      },
      billingAddress: {
        address1: '456 Billing St',
        city: 'Krakow',
        postalCode: '30-001',
        country: 'PL',
        firstName: 'John',
        lastName: 'Doe',
      },
      ...overrides,
    } as Order;
  };

  describe('updateProjectionsForOrder', () => {
    it('should throw error when internalCustomerId is empty', async () => {
      const order = createOrder();

      await expect(
        service.updateProjectionsForOrder(order, '', 'connection-123'),
      ).rejects.toThrow('Internal customer ID is required for projection updates');

      await expect(
        service.updateProjectionsForOrder(order, '   ', 'connection-123'),
      ).rejects.toThrow('Internal customer ID is required for projection updates');
    });

    it('should create shipping address projection', async () => {
      const order = createOrder();
      process.env.OL_STORE_PII = 'true';

      const savedAddress = new CustomerAddressProjection(
        'internal-customer-456',
        'hash123',
        'shipping',
        '123 Main St',
        'Apt 4',
        'Warsaw',
        '00-001',
        'PL',
        expect.any(Date),
        expect.any(Date),
        expect.any(Date),
      );
      customerProjectionService.upsertAddressProjection.mockResolvedValue(savedAddress);

      await service.updateProjectionsForOrder(order, 'internal-customer-456', 'connection-123');

      expect(customerProjectionService.upsertAddressProjection).toHaveBeenCalledTimes(2); // shipping + billing
      const shippingCall = customerProjectionService.upsertAddressProjection.mock.calls[0][0];
      expect(shippingCall.internalCustomerId).toBe('internal-customer-456');
      expect(shippingCall.addressType).toBe('shipping');
      expect(shippingCall.address1).toBe('123 Main St');
      expect(shippingCall.city).toBe('Warsaw');
    });

    it('should create billing address projection when different from shipping', async () => {
      const order = createOrder();
      process.env.OL_STORE_PII = 'true';

      await service.updateProjectionsForOrder(order, 'internal-customer-456', 'connection-123');

      expect(customerProjectionService.upsertAddressProjection).toHaveBeenCalledTimes(2);
      const billingCall = customerProjectionService.upsertAddressProjection.mock.calls[1][0];
      expect(billingCall.addressType).toBe('billing');
      expect(billingCall.address1).toBe('456 Billing St');
      expect(billingCall.city).toBe('Krakow');
    });

    it('should skip billing address projection when same as shipping', async () => {
      const order = createOrder({
        billingAddress: {
          address1: '123 Main St',
          address2: 'Apt 4',
          city: 'Warsaw',
          postalCode: '00-001',
          country: 'PL',
          firstName: 'John',
          lastName: 'Doe',
        },
      });
      process.env.OL_STORE_PII = 'true';

      await service.updateProjectionsForOrder(order, 'internal-customer-456', 'connection-123');

      // Should only create shipping projection (billing is same hash, skipped)
      expect(customerProjectionService.upsertAddressProjection).toHaveBeenCalledTimes(1);
      const call = customerProjectionService.upsertAddressProjection.mock.calls[0][0];
      expect(call.addressType).toBe('shipping');
    });

    it('should handle missing shipping address', async () => {
      const order = createOrder({ shippingAddress: undefined });
      process.env.OL_STORE_PII = 'true';

      await service.updateProjectionsForOrder(order, 'internal-customer-456', 'connection-123');

      // Should only create billing projection
      expect(customerProjectionService.upsertAddressProjection).toHaveBeenCalledTimes(1);
      const call = customerProjectionService.upsertAddressProjection.mock.calls[0][0];
      expect(call.addressType).toBe('billing');
    });

    it('should handle missing billing address', async () => {
      const order = createOrder({ billingAddress: undefined });
      process.env.OL_STORE_PII = 'true';

      await service.updateProjectionsForOrder(order, 'internal-customer-456', 'connection-123');

      // Should only create shipping projection
      expect(customerProjectionService.upsertAddressProjection).toHaveBeenCalledTimes(1);
      const call = customerProjectionService.upsertAddressProjection.mock.calls[0][0];
      expect(call.addressType).toBe('shipping');
    });

    it('should handle missing both addresses', async () => {
      const order = createOrder({
        shippingAddress: undefined,
        billingAddress: undefined,
      });

      await service.updateProjectionsForOrder(order, 'internal-customer-456', 'connection-123');

      // Should not create any address projections
      expect(customerProjectionService.upsertAddressProjection).not.toHaveBeenCalled();
    });
  });

  describe('PII toggle behavior', () => {
    it('should store PII fields when OL_STORE_PII=true', async () => {
      const order = createOrder();
      process.env.OL_STORE_PII = 'true';

      await service.updateProjectionsForOrder(order, 'internal-customer-456', 'connection-123');

      const call = customerProjectionService.upsertAddressProjection.mock.calls[0][0];
      expect(call.address1).toBe('123 Main St');
      expect(call.address2).toBe('Apt 4');
      expect(call.city).toBe('Warsaw');
      expect(call.postcode).toBe('00-001');
      expect(call.countryIso2).toBe('PL');
    });

    it('should not store PII fields when OL_STORE_PII=false', async () => {
      const order = createOrder();
      process.env.OL_STORE_PII = 'false';

      await service.updateProjectionsForOrder(order, 'internal-customer-456', 'connection-123');

      const call = customerProjectionService.upsertAddressProjection.mock.calls[0][0];
      expect(call.addressHash).toBeDefined(); // Hash always stored
      expect(call.address1).toBeNull();
      expect(call.address2).toBeNull();
      expect(call.city).toBeNull();
      expect(call.postcode).toBeNull();
      expect(call.countryIso2).toBeNull();
    });
  });

  describe('Address hash calculation', () => {
    it('should calculate same hash for identical addresses', async () => {
      const order1 = createOrder({
        shippingAddress: {
          address1: '123 Main St',
          city: 'Warsaw',
          postalCode: '00-001',
          country: 'PL',
        },
      });
      const order2 = createOrder({
        shippingAddress: {
          address1: '123 Main St',
          city: 'Warsaw',
          postalCode: '00-001',
          country: 'PL',
        },
      });
      process.env.OL_STORE_PII = 'true';

      await service.updateProjectionsForOrder(order1, 'internal-customer-456', 'connection-123');
      const hash1 = (customerProjectionService.upsertAddressProjection.mock.calls[0][0]).addressHash;

      jest.clearAllMocks();

      await service.updateProjectionsForOrder(order2, 'internal-customer-456', 'connection-123');
      const hash2 = (customerProjectionService.upsertAddressProjection.mock.calls[0][0]).addressHash;

      expect(hash1).toBe(hash2);
    });

    it('should calculate different hash for different addresses', async () => {
      const order = createOrder();
      process.env.OL_STORE_PII = 'true';

      await service.updateProjectionsForOrder(order, 'internal-customer-456', 'connection-123');

      const shippingHash = (customerProjectionService.upsertAddressProjection.mock.calls[0][0]).addressHash;
      const billingHash = (customerProjectionService.upsertAddressProjection.mock.calls[1][0]).addressHash;

      expect(shippingHash).not.toBe(billingHash);
    });
  });
});
