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
import { LocationInUseError } from '../../domain/exceptions/location-in-use.error';
import { DuplicateLocationCodeError } from '../../domain/exceptions/duplicate-location-code.error';
import {
  BOOTSTRAP_LOCATION_SPECS,
  type LocationBootstrapResult,
} from '../../domain/types/location-bootstrap.types';
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
    // The referential refusal lives HERE, not in the interface layer (#2316's
    // original placement): `inventory_items` carries no foreign key to
    // `inventory_locations` (ADR-058 decision 3 defers that to step iii), so
    // nothing in the database refuses the delete. A guard in the controller
    // protects only the HTTP caller — every other caller of this method would
    // strand the positions silently.
    //
    // Counted FIRST: an unknown id counts 0 and falls through to the 404
    // below, so the ordering costs nothing and never masks a missing row.
    const positionCount = await this.repository.countPositionsAtLocation(id);
    if (positionCount > 0) {
      throw new LocationInUseError(id, positionCount);
    }

    const deleted = await this.repository.delete(id);
    if (!deleted) {
      throw new LocationNotFoundException(id);
    }

    this.logger.log(`Deleted inventory location ${id}`);
  }

  async countActiveLocations(): Promise<number> {
    // Reuses the existing paged read for its `total` rather than adding a
    // count method to the port: `limit: 1` keeps the row payload at one row
    // while `total` answers the actual question.
    const { total } = await this.repository.list(
      { status: 'active' },
      { page: 1, limit: 1 }
    );
    return total;
  }

  async bootstrapDefaultLocations(): Promise<LocationBootstrapResult> {
    const created: InventoryLocation[] = [];
    const existingCodes: string[] = [];

    for (const spec of BOOTSTRAP_LOCATION_SPECS) {
      try {
        created.push(await this.createLocation(spec));
      } catch (error) {
        // ONLY the duplicate is expected, and it is the idempotency
        // mechanism rather than a failure: the code is already taken, so this
        // run must leave that row exactly as it is. Anything else is a real
        // fault and must not be swallowed into a success-shaped result.
        if (error instanceof DuplicateLocationCodeError) {
          existingCodes.push(this.normaliseCode(spec.code));
          continue;
        }
        throw error;
      }
    }

    this.logger.log(
      `Location bootstrap: created ${created.length}, already present ${existingCodes.length}`
    );
    return { created, existingCodes };
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
