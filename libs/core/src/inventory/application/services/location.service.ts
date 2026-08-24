/**
 * Location Service
 *
 * Thin CRUD orchestration over `LocationRepositoryPort` for the
 * operator-authored inventory locations of ADR-058 decision (1).
 *
 * **`code` is normalised in exactly one place — here.** The unique index is
 * case-sensitive, so if normalisation happened at each call site an operator
 * could still create both `WH1` and `wh1` wherever a site forgot. Every write
 * path routes through `normaliseCode`, and the int-spec asserts it.
 *
 * @module libs/core/src/inventory/application/services
 * @implements {ILocationService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { ILocationService } from './location.service.interface';
import { LocationRepositoryPort } from '../../domain/ports/location-repository.port';
import type { InventoryLocation } from '../../domain/entities/inventory-location.entity';
import { LocationNotFoundException } from '../../domain/exceptions/location-not-found.exception';
import { LOCATION_REPOSITORY_TOKEN } from '../../inventory.tokens';
import type {
  CreateInventoryLocationInput,
  UpdateInventoryLocationInput,
  InventoryLocationFilters,
  InventoryLocationPagination,
  PaginatedInventoryLocations,
} from '../../domain/types/location.types';

@Injectable()
export class LocationService implements ILocationService {
  private readonly logger = new Logger(LocationService.name);

  constructor(
    @Inject(LOCATION_REPOSITORY_TOKEN)
    private readonly repository: LocationRepositoryPort
  ) {}

  async createLocation(input: CreateInventoryLocationInput): Promise<InventoryLocation> {
    const location = await this.repository.create({
      ...input,
      code: this.normaliseCode(input.code),
      countryIso2: this.normaliseCountry(input.countryIso2),
    });

    this.logger.log(`Created inventory location ${location.code} (${location.id})`);
    return location;
  }

  async updateLocation(
    id: string,
    input: UpdateInventoryLocationInput
  ): Promise<InventoryLocation> {
    const updated = await this.repository.update(id, {
      ...input,
      ...(input.countryIso2 !== undefined
        ? { countryIso2: this.normaliseCountry(input.countryIso2) }
        : {}),
    });

    if (!updated) {
      throw new LocationNotFoundException(id);
    }

    return updated;
  }

  async getLocation(id: string): Promise<InventoryLocation | null> {
    return this.repository.findById(id);
  }

  async listLocations(
    filters: InventoryLocationFilters,
    pagination: InventoryLocationPagination
  ): Promise<PaginatedInventoryLocations> {
    return this.repository.list(filters, pagination);
  }

  async countPositionsAtLocation(locationId: string): Promise<number> {
    return this.repository.countPositionsAtLocation(locationId);
  }

  async deleteLocation(id: string): Promise<void> {
    const deleted = await this.repository.delete(id);
    if (!deleted) {
      throw new LocationNotFoundException(id);
    }

    this.logger.log(`Deleted inventory location ${id}`);
  }

  /**
   * Uppercase + trim. The single normalisation point for the case-sensitive
   * `UQ_inventory_locations_code` index.
   */
  private normaliseCode(code: string): string {
    return code.trim().toUpperCase();
  }

  /** ISO-3166-1 alpha-2 is uppercase by definition; `null` stays `null`. */
  private normaliseCountry(country: string | null | undefined): string | null {
    return country === null || country === undefined
      ? null
      : country.trim().toUpperCase();
  }
}
