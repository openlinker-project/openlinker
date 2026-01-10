/**
 * Connection Controller
 *
 * HTTP REST API endpoints for connection operations. Handles request validation,
 * delegates to application services, and formats responses.
 *
 * @module apps/api/src/integrations/http
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { ConnectionFiltersDto } from './dto/connection-filters.dto';
import { ConnectionResponseDto } from './dto/connection-response.dto';
import { ConnectionService } from '../application/services/connection.service';
import { ConnectionUpdate, ConnectionFilters } from '@openlinker/core/identifier-mapping';

@ApiTags('connections')
@Controller('connections')
export class ConnectionController {
  constructor(
    private readonly connectionService: ConnectionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new connection' })
  @ApiResponse({
    status: 201,
    description: 'Connection created successfully',
    type: ConnectionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async create(
    @Body() dto: CreateConnectionDto,
  ): Promise<ConnectionResponseDto> {
    const connection = await this.connectionService.create(dto);
    return ConnectionResponseDto.fromDomain(connection);
  }

  @Get()
  @ApiOperation({ summary: 'List connections with optional filters' })
  @ApiResponse({
    status: 200,
    description: 'List of connections',
    type: [ConnectionResponseDto],
  })
  async list(
    @Query() filtersDto: ConnectionFiltersDto,
  ): Promise<ConnectionResponseDto[]> {
    const filters: ConnectionFilters = {
      ...(filtersDto.platformType && { platformType: filtersDto.platformType }),
      ...(filtersDto.status && { status: filtersDto.status }),
    };
    const connections = await this.connectionService.list(filters);
    return connections.map((connection) =>
      ConnectionResponseDto.fromDomain(connection),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get connection by ID' })
  @ApiResponse({
    status: 200,
    description: 'Connection details',
    type: ConnectionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async get(@Param('id') id: string): Promise<ConnectionResponseDto> {
    const connection = await this.connectionService.get(id);
    return ConnectionResponseDto.fromDomain(connection);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing connection' })
  @ApiResponse({
    status: 200,
    description: 'Connection updated successfully',
    type: ConnectionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateConnectionDto,
  ): Promise<ConnectionResponseDto> {
    const patch: ConnectionUpdate = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.config !== undefined && { config: dto.config }),
      ...(dto.adapterKey !== undefined && { adapterKey: dto.adapterKey }),
    };
    const connection = await this.connectionService.update(id, patch);
    return ConnectionResponseDto.fromDomain(connection);
  }

  @Patch(':id/disable')
  @ApiOperation({ summary: 'Disable a connection' })
  @ApiResponse({
    status: 200,
    description: 'Connection disabled successfully',
    type: ConnectionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async disable(@Param('id') id: string): Promise<ConnectionResponseDto> {
    const connection = await this.connectionService.disable(id);
    return ConnectionResponseDto.fromDomain(connection);
  }
}

