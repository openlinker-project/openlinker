import type { ShipmentFilters, ShipmentPagination } from './shipments.types';

export const shipmentsQueryKeys = {
  all: ['shipments'] as const,
  list: (filters?: ShipmentFilters, pagination?: ShipmentPagination) =>
    ['shipments', 'list', filters ?? {}, pagination ?? {}] as const,
};
