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
import { IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}
