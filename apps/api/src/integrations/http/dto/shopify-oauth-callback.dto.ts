/**
 * Shopify OAuth Callback DTO
 *
 * The query string Shopify appended to the redirect, forwarded VERBATIM by the
 * web callback page. Taken whole rather than as named fields because its
 * `hmac` covers every other parameter Shopify sent, including ones this
 * service does not read; a fixed field list would break the check the day
 * Shopify adds a parameter.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ShopifyOAuthCallbackDto {
  @ApiProperty({
    description: 'The redirect\'s query string, exactly as received',
    example: 'code=abc&hmac=...&shop=my-shop.myshopify.com&state=...&timestamp=1700000000',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  rawQuery!: string;
}
