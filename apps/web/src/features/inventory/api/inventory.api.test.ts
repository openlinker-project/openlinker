/**
 * Inventory API Client tests (#3064)
 *
 * Covers the four routes newly added to `InventoryApi` — `listLocations`,
 * `getLocation`, `createLocation`, `updateLocation`, `deleteLocation`. The
 * pre-existing `listActiveLocations` / `bootstrapLocations` probes are
 * untouched and not re-tested here.
 */
import { describe, it, expect, vi } from 'vitest';
import { createInventoryApi } from './inventory.api';
import type { InventoryLocation } from './inventory-locations.types';

function location(overrides: Partial<InventoryLocation> = {}): InventoryLocation {
  return {
    id: 'ol_location_1',
    code: 'WH1',
    name: 'Main warehouse',
    kind: 'warehouse',
    ownerConnectionId: null,
    externalRef: null,
    status: 'active',
    countryIso2: null,
    postcode: null,
    latitude: null,
    longitude: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('createInventoryApi.listLocations', () => {
  it('should send no query string when nothing is filtered or paged', async () => {
    const request = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 25 });

    await createInventoryApi(request).listLocations();

    expect(request).toHaveBeenCalledWith('/inventory/locations');
  });

  it('should forward every declared filter and pagination field', async () => {
    const request = vi.fn().mockResolvedValue({ items: [], total: 0, page: 2, limit: 10 });

    await createInventoryApi(request).listLocations(
      { kind: 'warehouse', status: 'active', countryIso2: 'pl', codePrefix: 'WH' },
      { page: 2, limit: 10 },
    );

    const [path] = request.mock.calls[0] as [string];
    const query = new URLSearchParams(path.split('?')[1]);
    expect(query.get('kind')).toBe('warehouse');
    expect(query.get('status')).toBe('active');
    expect(query.get('codePrefix')).toBe('WH');
    expect(query.get('page')).toBe('2');
    expect(query.get('limit')).toBe('10');
  });

  it('should uppercase countryIso2 before sending it', async () => {
    const request = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 25 });

    await createInventoryApi(request).listLocations({ countryIso2: 'pl' });

    const [path] = request.mock.calls[0] as [string];
    expect(new URLSearchParams(path.split('?')[1]).get('countryIso2')).toBe('PL');
  });
});

describe('createInventoryApi.getLocation', () => {
  it('should request the location by id', async () => {
    const request = vi.fn().mockResolvedValue(location());

    await createInventoryApi(request).getLocation('ol_location_1');

    expect(request).toHaveBeenCalledWith('/inventory/locations/ol_location_1');
  });
});

describe('createInventoryApi.createLocation', () => {
  it('should POST the input as the JSON body', async () => {
    const request = vi.fn().mockResolvedValue(location());
    const input = { code: 'WH1', name: 'Main warehouse', kind: 'warehouse' as const };

    await createInventoryApi(request).createLocation(input);

    expect(request).toHaveBeenCalledWith('/inventory/locations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  });
});

describe('createInventoryApi.updateLocation', () => {
  it('should PATCH the patch as the JSON body against the location id', async () => {
    const request = vi.fn().mockResolvedValue(location({ name: 'Renamed' }));
    const patch = { name: 'Renamed' };

    await createInventoryApi(request).updateLocation('ol_location_1', patch);

    expect(request).toHaveBeenCalledWith('/inventory/locations/ol_location_1', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  });

  it('should serialize an explicit null as a clear, distinct from an omitted field', async () => {
    const request = vi.fn().mockResolvedValue(location());

    await createInventoryApi(request).updateLocation('ol_location_1', {
      ownerConnectionId: null,
    });

    const [, init] = request.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ ownerConnectionId: null });
    expect('name' in body).toBe(false);
  });
});

describe('createInventoryApi.deleteLocation', () => {
  it('should DELETE the location by id', async () => {
    const request = vi.fn().mockResolvedValue(undefined);

    await createInventoryApi(request).deleteLocation('ol_location_1');

    expect(request).toHaveBeenCalledWith('/inventory/locations/ol_location_1', {
      method: 'DELETE',
    });
  });
});
