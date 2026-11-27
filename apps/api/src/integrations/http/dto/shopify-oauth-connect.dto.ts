/**
 * Shopify OAuth Connect DTO
 *
 * Starts the authorization-code install of the OpenLinker Shopify app on a
 * store outside the app's organization (#3974, K03). The store domain and the
 * optional API version / location seed the new connection's config; the
 * client id + secret are held in the transient OAuth state until the callback.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CoreCapabilityValues, type CoreCapability } from '@openlinker/core/integrations';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderSyncStartDto } from './order-sync-start.dto';

export class ShopifyOAuthConnectDto {
  @ApiProperty({ description: 'The store\'s permanent domain', example: 'my-shop.myshopify.com' })
  @IsString()
  @IsNotEmpty()
  storeDomain!: string;

  @ApiProperty({ description: 'Client id of the Shopify app', example: 'your-client-id' })
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @ApiProperty({ description: 'Client secret of the Shopify app', example: 'your-client-secret' })
  @IsString()
  @IsNotEmpty()
  clientSecret!: string;

  @ApiProperty({
    description: 'Redirect URL registered on the Shopify app (the OpenLinker callback page)',
    example: 'https://openlinker.example.com/integrations/shopify/connect/callback',
  })
  @IsUrl({ require_tld: false })
  @IsString()
  @IsNotEmpty()
  redirectUri!: string;

  @ApiPropertyOptional({ description: 'Admin API version; the supported default when absent', example: '2026-10' })
  @IsString()
  @IsOptional()
  apiVersion?: string;

  @ApiPropertyOptional({ description: 'Shopify Location id or GID stock is read and written at' })
  @IsString()
  @IsOptional()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Name of the connection created on the callback' })
  @IsString()
  @IsOptional()
  connectionName?: string;

  @ApiPropertyOptional({
    description: 'Existing Shopify connection to re-authenticate in place instead of creating one',
  })
  @IsUUID()
  @IsOptional()
  connectionId?: string;

  @ApiPropertyOptional({
    description:
      'Capabilities the created connection enables; the adapter default applies when absent. ' +
      'ProductMaster and ProductPublisher cannot be combined.',
    enum: CoreCapabilityValues,
    isArray: true,
  })
  @IsArray()
  @IsIn(CoreCapabilityValues, { each: true })
  @IsOptional()
  enabledCapabilities?: CoreCapability[];

  @ApiPropertyOptional({
    description:
      'Where order sync starts for the new connection (#4265): `now` (default), `from` a date, or `all`. ' +
      'Carried through the OAuth round trip and stored when the connection is created, so it only applies ' +
      'when the capability set includes OrderSource. Ignored when re-authenticating an existing connection.',
    type: OrderSyncStartDto,
    example: { mode: 'from', from: '2026-10-01' },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderSyncStartDto)
  orderSyncStart?: OrderSyncStartDto;
}
