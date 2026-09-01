/**
 * Inventory Locations Controller
 *
 * HTTP REST CRUD over the operator-authored inventory locations of ADR-058
 * decision (1) — the interface layer on top of the #2313 core slice.
 *
 * Auth: the global `JwtAuthGuard` covers every route; the three write routes
 * additionally carry `@Roles('admin')`. Reads carry no `@Roles`, which in this
 * repo means "any authenticated user".
 *
 * **Two paths reach 404, deliberately.** `GET /:id` returns the repository's
 * `null` as a `NotFoundException` here, because the read contract is
 * null-returning by design and there is no domain exception to map. `PATCH` /
 * `DELETE` reach the same status through `LocationNotFoundException` and the
 * global `InventoryLocationExceptionFilter`, because the service already raises
 * it. One status, two mechanisms — worth knowing before "unifying" them.
 *
 * **The referenced-delete refusal lives here, not in the service**, because
 * `LocationRepositoryPort.delete`'s docblock assigns the referential check to
 * the surface that reports the 409. `inventory_items` carries no FK to
 * `inventory_locations` until ADR-058 step (iii), so nothing below this layer
 * can enforce it.
 *
 * **The count-then-delete pair is NOT atomic and is deliberately not wrapped in
 * a transaction.** With no FK there is nothing for a transaction to enforce, so
 * wrapping it would imply a guarantee the schema does not make. A position
 * inserted between the count and the delete is orphaned rather than blocked —
 * accepted for Wave 1b, and closed for real when step (iii) adds the FK.
 *
 * Pagination is `page`/`limit`, unlike `InventoryController`'s `limit`/`offset`
 * — see `ListLocationsQueryDto` for why.
 *
 * @module apps/api/src/inventory/http
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  LOCATION_SERVICE_TOKEN,
  type ILocationService,
  type InventoryLocation,
} from '@openlinker/core/inventory';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { ListLocationsQueryDto } from './dto/list-locations-query.dto';
import { LocationResponseDto } from './dto/location-response.dto';
import { PaginatedLocationsResponseDto } from './dto/paginated-locations-response.dto';
import { LocationBootstrapResponseDto } from './dto/location-bootstrap-response.dto';

@ApiBearerAuth()
@ApiTags('inventory')
@Controller('inventory/locations')
export class InventoryLocationsController {
  constructor(
    @Inject(LOCATION_SERVICE_TOKEN)
    private readonly locations: ILocationService
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List inventory locations',
    description:
      'Paginated, filtered listing ordered by code. Omitting `status` lists inactive locations too — ' +
      'inactive is a soft retirement, not a hidden state.',
  })
  @ApiResponse({ status: 200, type: PaginatedLocationsResponseDto })
  async list(@Query() query: ListLocationsQueryDto): Promise<PaginatedLocationsResponseDto> {
    const { kind, status, countryIso2, codePrefix, page = 1, limit = 25 } = query;

    const result = await this.locations.listLocations(
      {
        kind,
        status,
        // Stored uppercase (the service normalises on write) and the repository
        // filters country by equality, unlike `codePrefix`'s ILike — so a
        // lowercase query would silently match nothing.
        ...(countryIso2 !== undefined ? { countryIso2: countryIso2.toUpperCase() } : {}),
        codePrefix,
      },
      { page, limit }
    );

    return {
      items: result.items.map((location) => this.toDto(location)),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one inventory location' })
  @ApiResponse({ status: 200, type: LocationResponseDto })
  @ApiResponse({ status: 404, description: 'No location carries that id' })
  async get(@Param('id') id: string): Promise<LocationResponseDto> {
    const location = await this.locations.getLocation(id);
    if (!location) {
      throw new NotFoundException(`Inventory location not found: ${id}`);
    }
    return this.toDto(location);
  }

  @Post()
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an inventory location (admin only)',
    description:
      '`code` is normalised (trimmed + uppercased) by the application service, so `wh1` and `WH1` are the same code.',
  })
  @ApiResponse({ status: 201, type: LocationResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 409, description: 'A location already carries that code' })
  async create(@Body() dto: CreateLocationDto): Promise<LocationResponseDto> {
    // Delegated verbatim — normalisation is the service's single responsibility.
    const location = await this.locations.createLocation(dto);
    return this.toDto(location);
  }

  @Post('bootstrap')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create the first-run inventory location, idempotently (admin only)',
    description:
      'Mints the starting location that fulfilment routing requires before it can be enabled ' +
      '(#2407). Safe to call repeatedly: a code that already exists is reported in ' +
      '`existingCodes` and left untouched, so a re-run creates nothing. This is an offer an ' +
      'operator takes, never a seed — nothing creates these rows automatically, because minting ' +
      'on enable would make the zero-location refusal unreachable. Note the minted row locates no ' +
      'existing stock: a position with a NULL location means the master declines to locate its ' +
      'stock, and no location row is ever a stand-in for that.',
  })
  @ApiResponse({ status: 201, type: LocationBootstrapResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async bootstrap(): Promise<LocationBootstrapResponseDto> {
    const result = await this.locations.bootstrapDefaultLocations();
    return {
      created: result.created.map((location) => this.toDto(location)),
      existingCodes: [...result.existingCodes],
    };
  }

  @Patch(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update an inventory location (admin only)',
    description:
      'Partial update: an omitted field is left untouched, an explicit null clears a nullable column. ' +
      '`code` is not patchable — sending it is a 400.',
  })
  @ApiResponse({ status: 200, type: LocationResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'No location carries that id' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto
  ): Promise<LocationResponseDto> {
    const location = await this.locations.updateLocation(id, dto);
    return this.toDto(location);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an inventory location (admin only)',
    description:
      'Refused with 409 while inventory positions still reference the location — retire it with ' +
      'status=inactive instead, which keeps historical positions pointing at a row that exists.',
  })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'No location carries that id' })
  @ApiResponse({ status: 409, description: 'Positions still reference the location' })
  async remove(@Param('id') id: string): Promise<void> {
    // The in-use refusal is the SERVICE's (it raises `LocationInUseError`,
    // which the global filter maps to 409): a guard here would protect only
    // the HTTP caller while every other caller deleted unconditionally.
    await this.locations.deleteLocation(id);
  }

  /** Explicit allowlist — never spread the domain entity into a response. */
  private toDto(location: InventoryLocation): LocationResponseDto {
    return {
      id: location.id,
      code: location.code,
      name: location.name,
      kind: location.kind,
      ownerConnectionId: location.ownerConnectionId,
      externalRef: location.externalRef,
      status: location.status,
      countryIso2: location.countryIso2,
      postcode: location.postcode,
      latitude: location.latitude,
      longitude: location.longitude,
      createdAt:
        location.createdAt instanceof Date
          ? location.createdAt.toISOString()
          : location.createdAt,
      updatedAt:
        location.updatedAt instanceof Date
          ? location.updatedAt.toISOString()
          : location.updatedAt,
    };
  }
}
