/**
 * Connection Controller
 *
 * HTTP REST API endpoints for connection operations. Handles request validation,
 * delegates to application services, and formats responses.
 *
 * @module apps/api/src/integrations/http
 */
import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Inject,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Logger } from '@openlinker/shared/logging';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import { RotateWebhookSecretResponseDto } from './dto/rotate-webhook-secret-response.dto';
import { InstallWebhooksResponseDto } from './dto/install-webhooks-response.dto';
import { SetWebhookSecretDto } from './dto/set-webhook-secret.dto';
import { WebhookStatusResponseDto } from './dto/webhook-status-response.dto';
import {
  IWebhookSecretService,
  WEBHOOK_SECRET_SERVICE_TOKEN,
  CallerSuppliedWebhookSecretNotSupportedException,
} from '@openlinker/core/integrations';
import {
  IWebhookStatusService,
  WEBHOOK_STATUS_SERVICE_TOKEN,
} from '../application/interfaces/webhook-status.service.interface';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { UpdateConnectionCredentialsDto } from './dto/update-connection-credentials.dto';
import { ConnectionFiltersDto } from './dto/connection-filters.dto';
import { ConnectionResponseDto } from './dto/connection-response.dto';
import { ConnectionDiagnosticsResponseDto } from './dto/connection-diagnostics-response.dto';
import { ConnectionTestResultDto } from './dto/connection-test-result.dto';
import { ConnectionService } from '../application/services/connection.service';
import type {
  Connection,
  ConnectionUpdate,
  ConnectionFilters,
} from '@openlinker/core/identifier-mapping';
import { SyncJobRepositoryPort } from '@openlinker/core/sync';
import { SYNC_JOB_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  DEMO_MODE_SERVICE_TOKEN,
  type IDemoModeService,
} from '../../auth/demo-mode.service.interface';

@ApiBearerAuth()
@ApiTags('connections')
@Controller('connections')
export class ConnectionController {
  private readonly logger = new Logger(ConnectionController.name);

  constructor(
    private readonly connectionService: ConnectionService,
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly syncJobRepository: SyncJobRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(WEBHOOK_SECRET_SERVICE_TOKEN)
    private readonly webhookSecretService: IWebhookSecretService,
    @Inject(WEBHOOK_STATUS_SERVICE_TOKEN)
    private readonly webhookStatusService: IWebhookStatusService,
    @Inject(DEMO_MODE_SERVICE_TOKEN)
    private readonly demoModeService: IDemoModeService
  ) {}

  private async toResponse(
    connection: Connection,
    user?: AuthenticatedUser
  ): Promise<ConnectionResponseDto> {
    let supported: string[] = [];
    try {
      const metadata = await this.integrationsService.resolveAdapterMetadata({
        platformType: connection.platformType,
        adapterKey: connection.adapterKey,
      });
      supported = metadata.supportedCapabilities;
    } catch (error) {
      // Unknown adapter (e.g., legacy row with unmapped platformType). Leave
      // supportedCapabilities empty; the FE will render an "adapter not
      // recognized" notice. We still want this to be observable in the API
      // logs so operators can spot and fix the offending row.
      this.logger.warn(
        `Could not resolve adapter metadata for connection ${connection.id} (platformType=${connection.platformType}, adapterKey=${connection.adapterKey ?? '<derived>'}): ${(error as Error).message}`
      );
      supported = [];
    }
    return ConnectionResponseDto.fromDomain(
      connection,
      supported,
      user?.role,
      this.demoModeService.isDemoModeEnabled()
    );
  }

  @Roles('admin')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new connection' })
  @ApiResponse({
    status: 201,
    description: 'Connection created successfully',
    type: ConnectionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async create(
    @Body() dto: CreateConnectionDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<ConnectionResponseDto> {
    const connection = await this.connectionService.create(dto);
    return this.toResponse(connection, user);
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
    @CurrentUser() user: AuthenticatedUser
  ): Promise<ConnectionResponseDto[]> {
    const filters: ConnectionFilters = {
      ...(filtersDto.platformType && { platformType: filtersDto.platformType }),
      ...(filtersDto.status && { status: filtersDto.status }),
    };
    const connections = await this.connectionService.list(filters);
    return Promise.all(connections.map((connection) => this.toResponse(connection, user)));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get connection by ID' })
  @ApiResponse({
    status: 200,
    description: 'Connection details',
    type: ConnectionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async get(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<ConnectionResponseDto> {
    const connection = await this.connectionService.get(id);
    return this.toResponse(connection, user);
  }

  @Roles('admin')
  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing connection' })
  @ApiResponse({
    status: 200,
    description: 'Connection updated successfully',
    type: ConnectionResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateConnectionDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<ConnectionResponseDto> {
    const patch: ConnectionUpdate = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.config !== undefined && { config: dto.config }),
      ...(dto.adapterKey !== undefined && { adapterKey: dto.adapterKey }),
      ...(dto.enabledCapabilities !== undefined && {
        enabledCapabilities: dto.enabledCapabilities,
      }),
    };
    const connection = await this.connectionService.update(id, patch);
    return this.toResponse(connection, user);
  }

  @Roles('admin', 'operator', 'viewer')
  @Get(':id/diagnostics')
  @ApiOperation({ summary: 'Get connection diagnostics and activity summary' })
  @ApiResponse({
    status: 200,
    description: 'Connection diagnostics with recent sync job activity',
    type: ConnectionDiagnosticsResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async getDiagnostics(@Param('id') id: string): Promise<ConnectionDiagnosticsResponseDto> {
    const connection = await this.connectionService.get(id);
    const recentJobs = await this.syncJobRepository.findRecentByConnectionId(id, 10);
    return ConnectionDiagnosticsResponseDto.fromDomain(connection, recentJobs);
  }

  @Roles('admin')
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Probe the connection and return liveness result' })
  @ApiResponse({
    status: 200,
    description: 'Structured probe result (success/failure with latency)',
    type: ConnectionTestResultDto,
  })
  @ApiResponse({ status: 400, description: 'Adapter does not support testing' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async test(@Param('id') id: string): Promise<ConnectionTestResultDto> {
    const result = await this.connectionService.testConnection(id);
    return ConnectionTestResultDto.fromDomain(result);
  }

  @Roles('admin')
  @Put(':id/credentials')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Rotate the credentials stored for this connection' })
  @ApiResponse({ status: 204, description: 'Credentials rotated' })
  @ApiResponse({
    status: 400,
    description:
      'Invalid credential payload, failed shape validation, or connection is not db-backed',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async updateCredentials(
    @Param('id') id: string,
    @Body() dto: UpdateConnectionCredentialsDto
  ): Promise<void> {
    await this.connectionService.updateCredentials(id, dto.credentials);
  }

  @Roles('admin')
  @Post(':id/webhooks/secret/rotate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Rotate the webhook secret for this connection' })
  @ApiResponse({
    status: 201,
    description: 'New secret generated. Returned once; never retrievable again.',
    type: RotateWebhookSecretResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async rotateWebhookSecret(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<RotateWebhookSecretResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    const connection = await this.connectionService.get(id);
    const { secret } = await this.webhookSecretService.rotate(
      connection.platformType,
      id,
      user?.id
    );
    return {
      secret,
      revealedOnce: true,
      warning:
        'Store this secret now. It cannot be retrieved again — rotate to generate a new one.',
    };
  }

  /**
   * Set a caller-supplied webhook signing secret (#1770). Used when the
   * external platform mints the secret and the operator pastes it into OL
   * (e.g. inFakt). Distinct from rotate, whose server-generated value the
   * platform would never know. The value is stored encrypted; never returned.
   */
  @Roles('admin')
  @Put(':id/webhooks/secret')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a caller-supplied webhook secret for this connection (#1770)' })
  @ApiResponse({ status: 204, description: 'Secret stored (encrypted); never returned.' })
  @ApiResponse({ status: 400, description: 'Invalid secret payload' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async setWebhookSecret(
    @Param('id') id: string,
    @Body() dto: SetWebhookSecretDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    const connection = await this.connectionService.get(id);
    try {
      await this.webhookSecretService.set(connection.platformType, id, dto.secret, user?.id);
    } catch (error) {
      // Domain guard (#1770 review): `set` only accepts a caller-supplied
      // secret for platforms that mint one themselves (inFakt) - every other
      // connection's secret is server-rotated only. Map to 400, not 500.
      if (error instanceof CallerSuppliedWebhookSecretNotSupportedException) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * Operator-facing webhook status for this connection (#1770): activation
   * (inferred from delivery history) + signature configuration + latest
   * delivery summary. Read-only projection.
   */
  @Roles('admin')
  @Get(':id/webhooks/status')
  @ApiOperation({ summary: 'Read the inbound-webhook status for this connection (#1770)' })
  @ApiResponse({ status: 200, type: WebhookStatusResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async getWebhookStatus(@Param('id') id: string): Promise<WebhookStatusResponseDto> {
    const status = await this.webhookStatusService.getStatus(id);
    return WebhookStatusResponseDto.fromDomain(status);
  }

  /**
   * Auto-provision webhook configuration on the external platform for this
   * connection (#168, #583). Operator clicks once on the FE; OL routes to the
   * adapter-specific provisioner via `ConnectionService.installWebhooks`,
   * which looks up the implementation in `WebhookProvisioningRegistryService`
   * by adapterKey. PrestaShop today; other platforms follow the same shape
   * once they register a provisioner. Returns 400 if the connection's
   * adapter does not support webhook auto-provisioning.
   */
  @Roles('admin')
  @Post(':id/webhooks/install')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Auto-install webhook configuration on the external platform for this connection (#168, #583)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Configuration pushed. Body indicates whether the synchronous test ping ' +
      'completed successfully and whether OL recorded the configured state.',
    type: InstallWebhooksResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Adapter does not support webhook auto-provisioning, or connection config invalid',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async installWebhooks(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<InstallWebhooksResponseDto> {
    const result = await this.connectionService.installWebhooks(id, user?.id);
    return InstallWebhooksResponseDto.fromDomain(result);
  }

  @Roles('admin')
  @Patch(':id/disable')
  @ApiOperation({ summary: 'Disable a connection' })
  @ApiResponse({
    status: 200,
    description: 'Connection disabled successfully',
    type: ConnectionResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async disable(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<ConnectionResponseDto> {
    const connection = await this.connectionService.disable(id);
    return this.toResponse(connection, user);
  }
}
