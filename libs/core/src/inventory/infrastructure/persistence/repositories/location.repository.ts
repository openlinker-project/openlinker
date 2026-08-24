/**
 * Location Repository
 *
 * TypeORM implementation of `LocationRepositoryPort` for the operator-authored
 * inventory locations of ADR-058 decision (1).
 *
 * **Ids are minted with `formatInternalId('Location')`**, which falls through to
 * the lowercased default and yields `ol_location_*`. That is deliberate and
 * complete: there is no `ENTITY_TYPE_ID_PREFIX` override and no
 * `CoreEntityTypeValues` member, because that union is the *external-mapping*
 * vocabulary and a location has no external counterpart to map — `externalRef`
 * is a free-text operator field, not an identifier mapping. A later reader
 * should not "fix" the omission. Same shape as `ShipmentRepository`'s
 * `formatInternalId('Shipment')`.
 *
 * `numeric` geo columns come back from pg as strings and are coerced exactly
 * once, in `toDomain`.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/repositories
 * @implements {LocationRepositoryPort}
 * @see {@link InventoryLocationOrmEntity} for the database entity
 * @see {@link LocationRepositoryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, QueryFailedError, Repository } from 'typeorm';
import { formatInternalId } from '@openlinker/core/identifier-mapping';
import { InventoryItemOrmEntity } from '../entities/inventory-item.orm-entity';
import { InventoryLocationOrmEntity } from '../entities/inventory-location.orm-entity';
import type { LocationRepositoryPort } from '../../../domain/ports/location-repository.port';
import { InventoryLocation } from '../../../domain/entities/inventory-location.entity';
import { DuplicateLocationCodeError } from '../../../domain/exceptions/duplicate-location-code.error';
import type {
  CreateInventoryLocationInput,
  UpdateInventoryLocationInput,
  InventoryLocationFilters,
  InventoryLocationKind,
  InventoryLocationPagination,
  InventoryLocationStatus,
  PaginatedInventoryLocations,
} from '../../../domain/types/location.types';

@Injectable()
export class LocationRepository implements LocationRepositoryPort {
  constructor(
    @InjectRepository(InventoryLocationOrmEntity)
    private readonly ormRepository: Repository<InventoryLocationOrmEntity>,
    // The position count for #2316's referenced-delete 409. Both entities are
    // already registered on this context's `TypeOrmModule.forFeature`, so this
    // adds no module wiring; keeping the read here rather than on
    // `InventoryRepositoryPort` also keeps it off the file another wave owns.
    @InjectRepository(InventoryItemOrmEntity)
    private readonly inventoryItems: Repository<InventoryItemOrmEntity>
  ) {}

  async create(input: CreateInventoryLocationInput): Promise<InventoryLocation> {
    const entity = new InventoryLocationOrmEntity();
    entity.id = formatInternalId('Location');
    entity.code = input.code;
    entity.name = input.name;
    entity.kind = input.kind;
    entity.ownerConnectionId = input.ownerConnectionId ?? null;
    entity.externalRef = input.externalRef ?? null;
    entity.status = input.status ?? 'active';
    entity.countryIso2 = input.countryIso2 ?? null;
    entity.postcode = input.postcode ?? null;
    entity.latitude = this.toNumericColumn(input.latitude);
    entity.longitude = this.toNumericColumn(input.longitude);

    try {
      const saved = await this.ormRepository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      // Convert the infrastructure error to a domain error — nothing
      // TypeORM-shaped may escape the port.
      if (this.isUniqueCodeViolation(error)) {
        throw new DuplicateLocationCodeError(input.code);
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateInventoryLocationInput
  ): Promise<InventoryLocation | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    if (!entity) {
      return null;
    }

    // Only fields PRESENT on the input are written — an explicit `null` clears
    // the column, while an omitted key leaves it untouched.
    if (input.name !== undefined) entity.name = input.name;
    if (input.kind !== undefined) entity.kind = input.kind;
    if (input.ownerConnectionId !== undefined) {
      entity.ownerConnectionId = input.ownerConnectionId;
    }
    if (input.externalRef !== undefined) entity.externalRef = input.externalRef;
    if (input.status !== undefined) entity.status = input.status;
    if (input.countryIso2 !== undefined) entity.countryIso2 = input.countryIso2;
    if (input.postcode !== undefined) entity.postcode = input.postcode;
    if (input.latitude !== undefined) {
      entity.latitude = this.toNumericColumn(input.latitude);
    }
    if (input.longitude !== undefined) {
      entity.longitude = this.toNumericColumn(input.longitude);
    }

    const saved = await this.ormRepository.save(entity);
    return this.toDomain(saved);
  }

  async findById(id: string): Promise<InventoryLocation | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async list(
    filters: InventoryLocationFilters,
    pagination: InventoryLocationPagination
  ): Promise<PaginatedInventoryLocations> {
    const where: Record<string, unknown> = {};
    if (filters.kind !== undefined) where.kind = filters.kind;
    if (filters.status !== undefined) where.status = filters.status;
    if (filters.countryIso2 !== undefined) where.countryIso2 = filters.countryIso2;
    if (filters.codePrefix !== undefined) {
      where.code = ILike(`${this.escapeLike(filters.codePrefix)}%`);
    }

    const [entities, total] = await this.ormRepository.findAndCount({
      where,
      // Ordered by the unique natural key so a page boundary is stable.
      order: { code: 'ASC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });

    return {
      items: entities.map((entity) => this.toDomain(entity)),
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  async countPositionsAtLocation(locationId: string): Promise<number> {
    return this.inventoryItems.count({ where: { locationId } });
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.ormRepository.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Map ORM entity to domain entity.
   *
   * `numeric` comes back from pg as a string; `Number()` per the house
   * convention, guarded so a NULL column stays `null` rather than becoming `0`
   * — a coordinate of 0,0 is a real place off the coast of Africa, so
   * conflating "no geo" with zero would be a silently wrong location.
   */
  private toDomain(entity: InventoryLocationOrmEntity): InventoryLocation {
    return new InventoryLocation(
      entity.id,
      entity.code,
      entity.name,
      entity.kind as InventoryLocationKind,
      entity.ownerConnectionId,
      entity.externalRef,
      entity.status as InventoryLocationStatus,
      entity.countryIso2,
      entity.postcode,
      entity.latitude === null || entity.latitude === undefined
        ? null
        : Number(entity.latitude),
      entity.longitude === null || entity.longitude === undefined
        ? null
        : Number(entity.longitude),
      entity.createdAt,
      entity.updatedAt
    );
  }

  /** Numeric columns are written as strings so pg never round-trips a float. */
  private toNumericColumn(value: number | null | undefined): string | null {
    return value === null || value === undefined ? null : String(value);
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
  }

  private isUniqueCodeViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      /duplicate key|UQ_inventory_locations_code/i.test(error.message)
    );
  }
}
