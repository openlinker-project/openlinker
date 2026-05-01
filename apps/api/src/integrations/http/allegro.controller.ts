/**
 * Allegro Integration Controller
 *
 * HTTP REST API endpoints for Allegro integration operations. Handles OAuth
 * flow (connect, callback), connection validation, and Allegro-specific
 * connection management.
 *
 * @module apps/api/src/integrations/http
 */
import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  Inject,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  FileTypeValidator,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { IAllegroOAuthService, ALLEGRO_OAUTH_SERVICE_TOKEN } from '../application/interfaces/allegro-oauth.service.interface';
import { AllegroOAuthConnectDto } from './dto/allegro-oauth-connect.dto';
import { AllegroOAuthCallbackQueryDto } from './dto/allegro-oauth-callback-query.dto';
import { ConnectionCursorRepositoryPort, CONNECTION_CURSOR_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import {
  AllegroQuantityCommandRepositoryPort,
  ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN,
  AllegroQuantityCommand,
} from '@openlinker/integrations-allegro';
import { AllegroQuantityCommandResponseDto } from './dto/allegro-quantity-command-response.dto';
import { AllegroCommandsQueryDto } from './dto/allegro-commands-query.dto';
import { Logger } from '@openlinker/shared/logging';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  type OfferManagerPort,
  type ResponsibleProducerEntry,
  isResponsibleProducerReader,
  isSafetyAttachmentUploader,
} from '@openlinker/core/listings';
import {
  ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES,
  ALLEGRO_SAFETY_ATTACHMENT_MIME_PATTERN,
} from '@openlinker/integrations-allegro';
import { UploadSafetyAttachmentResponseDto } from './dto/upload-safety-attachment-response.dto';

@ApiTags('allegro')
@Controller('integrations/allegro')
export class AllegroController {
  private readonly logger = new Logger(AllegroController.name);

  constructor(
    @Inject(ALLEGRO_OAUTH_SERVICE_TOKEN)
    private readonly oauthService: IAllegroOAuthService,
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort,
    @Inject(ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN)
    private readonly commandRepository: AllegroQuantityCommandRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
  ) {}

  @Roles('admin')
  @ApiBearerAuth()
  @Post('oauth/connect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate Allegro OAuth flow' })
  @ApiResponse({
    status: 200,
    description: 'OAuth authorization URL generated successfully',
    schema: {
      type: 'object',
      properties: {
        authorizationUrl: {
          type: 'string',
          example: 'https://allegro.pl.allegrosandbox.pl/auth/oauth/authorize?client_id=...&response_type=code&redirect_uri=...&state=...',
        },
        state: {
          type: 'string',
          example: 'random-state-string',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async connect(@Body() dto: AllegroOAuthConnectDto): Promise<{
    authorizationUrl: string;
    state: string;
  }> {
    this.logger.log(`Initiating OAuth flow for Allegro (environment: ${dto.environment || 'sandbox'})`);

    // Store clientSecret in state temporarily during OAuth flow
    // After OAuth completes, credentials are stored in the database
    const result = await this.oauthService.generateAuthorizationUrl(
      dto.clientId,
      dto.clientSecret, // Used during OAuth flow, then stored in DB
      dto.redirectUri,
      dto.environment || 'sandbox',
      dto.state,
      dto.connectionName,
      dto.masterCatalogConnectionId,
    );

    return result;
  }

  @Public()
  @Get('oauth/callback')
  @ApiOperation({ summary: 'Handle Allegro OAuth callback' })
  @ApiQuery({ name: 'code', description: 'OAuth authorization code', required: true })
  @ApiQuery({ name: 'state', description: 'OAuth state parameter (required for CSRF protection)', required: false })
  @ApiResponse({
    status: 200,
    description: 'OAuth callback processed successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'OAuth callback processed successfully. Connection created.' },
        connectionId: { type: 'string', example: '123e4567-e89b-12d3-a456-426614174000' },
        connectionName: { type: 'string', example: 'Allegro sandbox connection' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid OAuth callback parameters or state validation failed' })
  async callback(
    @Query() query: AllegroOAuthCallbackQueryDto,
  ): Promise<{
    message: string;
    connectionId: string;
    connectionName: string;
  }> {
    this.logger.log('Received Allegro OAuth callback');

    // Validate state parameter (required for CSRF protection)
    if (!query.state) {
      throw new BadRequestException('Missing state parameter (required for CSRF protection)');
    }

    try {
      // Validate state parameter (CSRF protection)
      const stateData = await this.oauthService.validateState(query.state);
      if (!stateData) {
        // State is gone — check if this is a replayed callback within the idempotency window
        const completed = await this.oauthService.checkCompletedState(query.state);
        if (completed) {
          this.logger.log(`OAuth callback replayed for already-completed state: ${query.state}`);
          return {
            message: 'OAuth callback processed successfully. Connection created.',
            connectionId: completed.connectionId,
            connectionName: completed.connectionName,
          };
        }
        throw new BadRequestException({
          message: 'Invalid or expired OAuth state parameter',
          code: 'OAUTH_STATE_INVALID',
        });
      }

      // Exchange code for token using credentials from validated state
      const tokenResponse = await this.oauthService.exchangeCodeForToken(
        query.code,
        stateData.clientId,
        stateData.clientSecret,
        stateData.redirectUri,
        stateData.environment,
      );

      // Store credentials in database and create connection
      const connection = await this.oauthService.storeCredentialsAndCreateConnection(tokenResponse, stateData);

      // Persist completed marker so replayed callbacks within the TTL window get an idempotent 200
      await this.oauthService.markStateCompleted(query.state, connection.id, connection.name);

      return {
        message: 'OAuth callback processed successfully. Connection created.',
        connectionId: connection.id,
        connectionName: connection.name,
      };
    } catch (error) {
      this.logger.error(`OAuth callback error: ${(error as Error).message}`, error);
      throw error;
    }
  }

  @ApiBearerAuth()
  @Get('connections/:id/validate')
  @ApiOperation({ summary: 'Validate Allegro connection configuration' })
  @ApiParam({ name: 'id', description: 'Connection ID (UUID)', example: '123e4567-e89b-12d3-a456-426614174000' })
  @ApiResponse({
    status: 200,
    description: 'Connection validation result',
    schema: {
      type: 'object',
      properties: {
        valid: {
          type: 'boolean',
          example: true,
        },
        errors: {
          type: 'array',
          items: { type: 'string' },
          example: [],
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async validate(@Param('id') connectionId: string): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    this.logger.log(`Validating Allegro connection: ${connectionId}`);
    return this.oauthService.validateConnection(connectionId);
  }

  @ApiBearerAuth()
  @Get('connections/:id/cursors')
  @ApiOperation({ summary: 'Get all cursors for an Allegro connection' })
  @ApiParam({ name: 'id', description: 'Connection ID (UUID)' })
  @ApiQuery({ name: 'cursorKey', required: false, description: 'Optional cursor key filter' })
  @ApiResponse({
    status: 200,
    description: 'List of cursors for the connection',
    schema: {
      type: 'object',
      properties: {
        cursors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cursorKey: { type: 'string', example: 'allegro.orders.lastEventId' },
              value: { type: 'string', example: 'event-123' },
              updatedAt: { type: 'string', example: '2025-01-01T12:00:00.000Z' },
            },
          },
        },
      },
    },
  })
  async getCursors(
    @Param('id') connectionId: string,
    @Query('cursorKey') cursorKey?: string,
  ): Promise<{
    cursors: Array<{
      cursorKey: string;
      value: string;
      updatedAt: Date;
    }>;
  }> {
    this.logger.log(`Getting cursors for Allegro connection: ${connectionId}`);

    // For MVP, if cursorKey is provided, return single cursor
    // TODO: Add repository method to list all cursors for a connection
    if (cursorKey) {
      const value = await this.cursorRepository.get(connectionId, cursorKey);
      if (value === null) {
        return { cursors: [] };
      }
      // Note: Repository doesn't return updatedAt, so we use current time as approximation
      // TODO: Add updatedAt to cursor repository if needed
      return {
        cursors: [
          {
            cursorKey,
            value,
            updatedAt: new Date(),
          },
        ],
      };
    }

    // For MVP without cursorKey, return empty array
    // TODO: Implement listAllCursors method in repository
    return { cursors: [] };
  }

  @ApiBearerAuth()
  @Get('connections/:id/commands')
  @ApiOperation({ summary: 'Get quantity commands for an Allegro connection' })
  @ApiParam({ name: 'id', description: 'Connection ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'List of quantity commands',
    type: [AllegroQuantityCommandResponseDto],
  })
  async getCommands(
    @Param('id') connectionId: string,
    @Query() query: AllegroCommandsQueryDto,
  ): Promise<AllegroQuantityCommandResponseDto[]> {
    this.logger.log(`Getting commands for Allegro connection: ${connectionId}`);

    const commands = await this.commandRepository.find({
      connectionId,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });

    return commands.map((command: AllegroQuantityCommand) => AllegroQuantityCommandResponseDto.fromDomain(command));
  }

  @ApiBearerAuth()
  @Get('connections/:id/commands/failed')
  @ApiOperation({ summary: 'Get failed quantity commands for an Allegro connection' })
  @ApiParam({ name: 'id', description: 'Connection ID (UUID)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum number of commands to return', type: Number })
  @ApiResponse({
    status: 200,
    description: 'List of failed quantity commands',
    type: [AllegroQuantityCommandResponseDto],
  })
  async getFailedCommands(
    @Param('id') connectionId: string,
    @Query('limit') limit?: number,
  ): Promise<AllegroQuantityCommandResponseDto[]> {
    this.logger.log(`Getting failed commands for Allegro connection: ${connectionId}`);

    const commands = await this.commandRepository.find({
      connectionId,
      status: 'failed',
      limit: limit ? parseInt(String(limit), 10) : undefined,
    });

    return commands.map((command: AllegroQuantityCommand) => AllegroQuantityCommandResponseDto.fromDomain(command));
  }

  @ApiBearerAuth()
  @Get('connections/:id/commands/:commandId')
  @ApiOperation({ summary: 'Get quantity command by commandId for a connection' })
  @ApiParam({ name: 'id', description: 'Connection ID (UUID)' })
  @ApiParam({ name: 'commandId', description: 'Allegro command ID' })
  @ApiResponse({
    status: 200,
    description: 'Command details',
    type: AllegroQuantityCommandResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Command not found' })
  async getCommand(
    @Param('id') connectionId: string,
    @Param('commandId') commandId: string,
  ): Promise<AllegroQuantityCommandResponseDto> {
    this.logger.log(`Getting command: ${commandId} for connection: ${connectionId}`);

    const command = await this.commandRepository.findByCommandId(commandId);
    if (!command) {
      throw new NotFoundException(`Command not found: ${commandId}`);
    }

    // Validate that command belongs to the specified connection
    if (command.connectionId !== connectionId) {
      throw new NotFoundException(`Command not found: ${commandId}`);
    }

    return AllegroQuantityCommandResponseDto.fromDomain(command);
  }

  /**
   * List the seller's EU GPSR responsible-producer registry. Backs the
   * dropdown on the Allegro connection-edit page (#430). Adapter-resolved
   * per connection: returns 200 with the neutral entry list, or 400 when
   * the resolved adapter doesn't support the `ResponsibleProducerReader`
   * capability.
   *
   * No local persistence — the registry is operator-driven (entries are
   * created in Allegro's seller panel, not from inside OL), so freshness
   * matters more than latency for a settings page.
   */
  @Roles('admin')
  @ApiBearerAuth()
  @Get('connections/:id/responsible-producers')
  @ApiOperation({
    summary: 'List EU GPSR responsible-producer entries for the connection',
  })
  @ApiParam({ name: 'id', description: 'Connection ID' })
  @ApiResponse({ status: 200, description: 'Responsible-producer entries returned' })
  async listResponsibleProducers(
    @Param('id') connectionId: string,
  ): Promise<ResponsibleProducerEntry[]> {
    this.logger.debug(
      `Listing Allegro responsible producers (connection: ${connectionId})`,
    );
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager',
    );
    if (!isResponsibleProducerReader(adapter)) {
      throw new BadRequestException(
        `Connection ${connectionId} does not support the ResponsibleProducerReader capability`,
      );
    }
    return adapter.fetchResponsibleProducers();
  }

  @Roles('admin')
  @ApiBearerAuth()
  @Post('connections/:id/safety-attachments')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES },
    }),
  )
  @ApiOperation({
    summary: 'Upload an Allegro safety-information attachment for a connection',
    description:
      'Forwards the file bytes to Allegro as multipart/form-data and returns the attachment id ' +
      'to reference from `productSet[*].safetyInformation.attachments[].id` on offer create. ' +
      'OL does not persist the file; Allegro is the system of record.',
  })
  @ApiParam({ name: 'id', description: 'Connection ID' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, type: UploadSafetyAttachmentResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed (mime type, size, missing capability)' })
  async uploadSafetyAttachment(
    @Param('id') connectionId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES }),
          new FileTypeValidator({ fileType: ALLEGRO_SAFETY_ATTACHMENT_MIME_PATTERN }),
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<UploadSafetyAttachmentResponseDto> {
    this.logger.debug(
      `Uploading Allegro safety attachment (connection: ${connectionId}, fileName: ${file.originalname}, ${file.size} bytes)`,
    );
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager',
    );
    // Defence-in-depth: this route lives under `integrations/allegro`, so a
    // non-Allegro `connectionId` is rejected by the IntegrationsService
    // resolver before reaching the capability narrow. The guard stays here
    // for the day this surface goes capability-scoped (per #472).
    if (!isSafetyAttachmentUploader(adapter)) {
      throw new BadRequestException(
        `Connection ${connectionId} does not support the SafetyAttachmentUploader capability`,
      );
    }
    const result = await adapter.uploadSafetyAttachment({
      bytes: new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength),
      mimeType: file.mimetype,
      fileName: file.originalname,
    });
    return {
      id: result.id,
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    };
  }
}

