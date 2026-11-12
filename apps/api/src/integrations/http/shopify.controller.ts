/**
 * Shopify Integration Controller
 *
 * OAuth install of the Shopify app on a store outside the app's organization
 * (#3974, K03), over the neutral `IOAuthConnectionService`: this controller
 * supplies the platform binding, the store seed of the connection config, and
 * the callback check only Shopify knows - the `hmac` over the redirect query
 * and the `shop` it names - which runs before the code is exchanged.
 *
 * Stores in the app's own organization do not come here: they connect with
 * the client id + secret (client-credentials grant) or a pre-issued token
 * through the ordinary connection create.
 *
 * Also serves the location picker of the connection edit page (#3982): the
 * shop's locations, read live, so the operator chooses one instead of typing
 * an id. A failure to reach the shop is a 502, never an empty list - an empty
 * picker would read as "this shop has no locations".
 *
 * @module apps/api/src/integrations/http
 */
import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping';
import {
  SHOPIFY_ADAPTER_KEY,
  SHOPIFY_LOCATION_READER_TOKEN,
  SHOPIFY_PLATFORM_TYPE,
  checkShopifyOAuthCallback,
  parseShopifyConfig,
  type IShopifyLocationReader,
  type ShopifyLocationSummary,
} from '@openlinker/integrations-shopify';
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';

import { Public } from '../../auth/decorators/public.decorator';
import { codedHttpError } from '../../common/errors/coded-http.exception';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  IOAuthConnectionService,
  OAUTH_CONNECTION_SERVICE_TOKEN,
} from '../application/interfaces/oauth-connection.service.interface';
import { toConfigShapeErrorBody } from '../application/services/connection-shape-error-body';
import { ShopifyOAuthCallbackDto } from './dto/shopify-oauth-callback.dto';
import { ShopifyOAuthConnectDto } from './dto/shopify-oauth-connect.dto';

export interface ShopifyOAuthCallbackResponse {
  message: string;
  connectionId: string;
  connectionName: string;
}

@ApiTags('shopify')
@Controller('integrations/shopify')
export class ShopifyController {
  private readonly logger = new Logger(ShopifyController.name);

  constructor(
    @Inject(OAUTH_CONNECTION_SERVICE_TOKEN)
    private readonly oauthService: IOAuthConnectionService,
    @Inject(SHOPIFY_LOCATION_READER_TOKEN)
    private readonly locationReader: IShopifyLocationReader,
  ) {}

  @Roles('admin', 'operator')
  @ApiBearerAuth()
  @Get('connections/:connectionId/locations')
  @ApiOperation({ summary: "List the Shopify store's active locations for the location picker" })
  @ApiResponse({ status: 200, description: 'Locations, the primary one first' })
  @ApiResponse({ status: 400, description: 'Not a Shopify connection' })
  @ApiResponse({ status: 502, description: 'The store could not be read' })
  async listLocations(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ): Promise<{ locations: ShopifyLocationSummary[] }> {
    try {
      return { locations: await this.locationReader.listLocations(connectionId) };
    } catch (error) {
      if (error instanceof HttpException || error instanceof ConnectionNotFoundException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Shopify locations read failed for connection ${connectionId}: ${message}`);
      throw new BadGatewayException({
        message: 'The Shopify store could not be read',
        code: 'SHOPIFY_LOCATIONS_UNAVAILABLE',
      });
    }
  }

  @Roles('admin')
  @ApiBearerAuth()
  @Post('oauth/connect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start the Shopify OAuth install for a store' })
  @ApiResponse({ status: 200, description: 'Authorization URL to send the operator to' })
  @ApiResponse({ status: 400, description: 'Invalid store domain, API version, location id or input' })
  async connect(@Body() dto: ShopifyOAuthConnectDto): Promise<{ authorizationUrl: string; state: string }> {
    // The whole seed is checked now, not after the merchant approved the app:
    // the same parser refuses it again when the callback creates the connection.
    const seed: Record<string, unknown> = {
      storeDomain: dto.storeDomain,
      ...(dto.apiVersion ? { apiVersion: dto.apiVersion } : {}),
      ...(dto.locationId ? { locationId: dto.locationId } : {}),
    };
    const parsed = parseShopifyConfig(seed);
    if (!parsed.ok) {
      // Same envelope a config save answers with (VALIDATION_FAILED + fields).
      throw new BadRequestException(
        toConfigShapeErrorBody(
          new InvalidConnectionConfigException(
            'Shopify',
            parsed.issues.map(({ path, message }) => ({ path, message })),
          ),
        ),
      );
    }
    const storeDomain = parsed.config.storeDomain;
    return this.oauthService.generateAuthorizationUrl({
      adapterKey: SHOPIFY_ADAPTER_KEY,
      platformType: SHOPIFY_PLATFORM_TYPE,
      clientId: dto.clientId,
      clientSecret: dto.clientSecret,
      redirectUri: dto.redirectUri,
      connectionName: dto.connectionName || `Shopify ${storeDomain}`,
      connectionId: dto.connectionId,
      // A reauth rotates credentials only, so the config seed is used to reach
      // the store and is not written over the connection's config (#3911).
      initialConfig: { ...seed, storeDomain },
    });
  }

  @Public()
  @Post('oauth/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete the Shopify OAuth install from the redirect query' })
  @ApiResponse({ status: 200, description: 'Connection created or re-authenticated' })
  @ApiResponse({ status: 400, description: 'Invalid state, hmac or shop' })
  async callback(@Body() dto: ShopifyOAuthCallbackDto): Promise<ShopifyOAuthCallbackResponse> {
    const state = new URLSearchParams(dto.rawQuery.replace(/^\?/, '')).get('state');
    if (!state) {
      throw codedHttpError(
        HttpStatus.BAD_REQUEST,
        'OAUTH_STATE_MISSING',
        'Missing state parameter (required for CSRF protection)',
      );
    }

    const stateData = await this.oauthService.validateState(state);
    if (!stateData) {
      const completed = await this.oauthService.checkCompletedState(state);
      if (completed) {
        return {
          message: 'Shopify store connected.',
          connectionId: completed.connectionId,
          connectionName: completed.connectionName,
        };
      }
      throw codedHttpError(
        HttpStatus.BAD_REQUEST,
        'OAUTH_STATE_INVALID',
        'Invalid or expired OAuth state parameter',
      );
    }
    if (stateData.adapterKey !== SHOPIFY_ADAPTER_KEY) {
      throw codedHttpError(
        HttpStatus.BAD_REQUEST,
        'OAUTH_STATE_INVALID',
        'OAuth state belongs to another platform',
      );
    }

    const expectedStore = stateData.initialConfig?.storeDomain;
    const check = checkShopifyOAuthCallback(
      dto.rawQuery,
      stateData.clientSecret,
      typeof expectedStore === 'string' ? expectedStore : '',
    );
    if (!check.ok) {
      this.logger.warn(`Shopify OAuth callback refused: ${check.refusal}`);
      throw codedHttpError(
        HttpStatus.BAD_REQUEST,
        'OAUTH_CALLBACK_UNVERIFIED',
        'The Shopify redirect could not be verified',
        { platformType: SHOPIFY_PLATFORM_TYPE, reason: check.refusal },
      );
    }

    const connection = await this.oauthService.completeAuthorization(check.code, stateData);
    await this.oauthService.markStateCompleted(state, connection.id, connection.name);
    return {
      message: 'Shopify store connected.',
      connectionId: connection.id,
      connectionName: connection.name,
    };
  }
}
