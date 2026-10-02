import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { DuplicateIdentifierMappingError } from '@openlinker/core/identifier-mapping';
import type { SyncLockPort } from '@openlinker/core/sync';

import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import { ShoperCustomerUnresolvableException } from '../../../domain/exceptions/shoper-customer-unresolvable.exception';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { ShoperCustomerProvisioner } from '../shoper-customer.provisioner';

const CONNECTION_ID = 'conn-1';
const MAPPED = [{ connectionId: CONNECTION_ID, externalId: '77', platformType: 'shoper', entityType: 'Customer' }];

function setup(options: { mappings?: unknown[][]; lock?: string | null } = {}) {
  const getExternalIds = jest.fn();
  for (const m of options.mappings ?? [[]]) {
    getExternalIds.mockResolvedValueOnce(m);
  }
  getExternalIds.mockResolvedValue([]);
  const createMapping = jest.fn().mockResolvedValue(undefined);
  const mapping = { getExternalIds, createMapping } as unknown as IdentifierMappingPort;
  const lock = {
    acquire: jest.fn().mockResolvedValue(options.lock === undefined ? 'tok' : options.lock),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const post = jest.fn();
  const get = jest.fn();
  const client = { post, get } as unknown as ShoperHttpClient;
  const provisioner = new ShoperCustomerProvisioner(lock as unknown as SyncLockPort);
  const resolve = (overrides: Record<string, unknown> = {}) =>
    provisioner.resolveOrCreateCustomer({
      internalCustomerId: 'ol_customer_1',
      buyerEmail: 'Jan@Example.com',
      firstName: 'Jan',
      lastName: 'Kowalski',
      connectionId: CONNECTION_ID,
      client,
      identifierMapping: mapping,
      ...overrides,
    });
  return { resolve, post, get, createMapping, lock, getExternalIds };
}

describe('ShoperCustomerProvisioner', () => {
  it('should return the mapped user without touching Shoper when a mapping exists', async () => {
    const { resolve, post, lock } = setup({ mappings: [MAPPED] });

    await expect(resolve()).resolves.toBe('77');

    expect(post).not.toHaveBeenCalled();
    expect(lock.acquire).not.toHaveBeenCalled();
  });

  it('should create the user and record the mapping on the first order', async () => {
    const { resolve, post, createMapping, lock } = setup();
    post.mockResolvedValue({ status: 200, data: 91 });

    await expect(resolve()).resolves.toBe('91');

    expect(post).toHaveBeenCalledWith('/users', {
      email: 'Jan@Example.com',
      firstname: 'Jan',
      lastname: 'Kowalski',
      active: 1,
    });
    expect(createMapping).toHaveBeenCalledWith('Customer', '91', CONNECTION_ID, 'ol_customer_1');
    expect(lock.release).toHaveBeenCalledWith(expect.stringContaining('shoper:customer-provision:'), 'tok');
  });

  it('should read the id off an object answer too', async () => {
    const { resolve, post } = setup();
    post.mockResolvedValue({ status: 200, data: { user_id: '12' } });

    await expect(resolve()).resolves.toBe('12');
  });

  it('should fall back to the existing user by email on the duplicate-email 400', async () => {
    const { resolve, post, get, createMapping } = setup();
    post.mockRejectedValue(new ShoperApiError(400, 'invalid_request', 'już istnieje'));
    get.mockResolvedValue({
      status: 200,
      data: { list: [{ user_id: '5', email: 'other@example.com' }, { user_id: '6', email: 'jan@example.com' }] },
    });

    await expect(resolve()).resolves.toBe('6');

    expect(get).toHaveBeenCalledWith('/users', { 'filters[email]': 'Jan@Example.com' });
    expect(createMapping).toHaveBeenCalledWith('Customer', '6', CONNECTION_ID, 'ol_customer_1');
  });

  it('should rethrow the original 400 when no user has that email', async () => {
    const { resolve, post, get } = setup();
    const error = new ShoperApiError(400, 'invalid_request', 'bad payload');
    post.mockRejectedValue(error);
    get.mockResolvedValue({ status: 200, data: { list: [] } });

    await expect(resolve()).rejects.toBe(error);
  });

  it.each([401, 500])('should not swallow an HTTP %i into a guest', async (status) => {
    const { resolve, post, get } = setup();
    post.mockRejectedValue(new ShoperApiError(status));

    await expect(resolve()).rejects.toBeInstanceOf(ShoperApiError);
    expect(get).not.toHaveBeenCalled();
  });

  it('should converge on the winner when the mapping was written concurrently', async () => {
    const { resolve, post, createMapping } = setup({ mappings: [[], [], MAPPED] });
    post.mockResolvedValue({ status: 200, data: 91 });
    createMapping.mockRejectedValue(
      new DuplicateIdentifierMappingError('Customer', '91', 'shoper', CONNECTION_ID),
    );

    await expect(resolve()).resolves.toBe('77');
  });

  it('should use a mapping written while waiting for the lock', async () => {
    const { resolve, post } = setup({ mappings: [[], MAPPED] });

    await expect(resolve()).resolves.toBe('77');
    expect(post).not.toHaveBeenCalled();
  });

  it('should proceed unserialized, not fail, when the lock cannot be acquired', async () => {
    jest.useFakeTimers();
    try {
      const { resolve, post, lock } = setup({ lock: null });
      post.mockResolvedValue({ status: 200, data: 91 });

      const pending = resolve();
      await jest.runAllTimersAsync();

      await expect(pending).resolves.toBe('91');
      expect(lock.release).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('should refuse an order with no buyer email, never falling back to a guest', async () => {
    const { resolve, post } = setup();

    await expect(resolve({ buyerEmail: undefined })).rejects.toBeInstanceOf(
      ShoperCustomerUnresolvableException,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('should refuse an order with no customer', async () => {
    const { resolve } = setup();

    await expect(resolve({ internalCustomerId: undefined })).rejects.toBeInstanceOf(
      ShoperCustomerUnresolvableException,
    );
  });

  it('should refuse a create that returns no user id', async () => {
    const { resolve, post } = setup();
    post.mockResolvedValue({ status: 200, data: {} });

    await expect(resolve()).rejects.toBeInstanceOf(ShoperCustomerUnresolvableException);
  });
});
