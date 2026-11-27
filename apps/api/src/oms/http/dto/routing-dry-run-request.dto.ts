/**
 * Routing Dry-Run Request DTO (#2954)
 *
 * Body for POST /connections/:connectionId/sourcing-rules/dry-run. Exactly one
 * of `orderId` and `basket`; the controller enforces the exclusivity because
 * class-validator cannot express "one of two optionals". A basket carries only
 * what the router may see (ADR-062): there is deliberately no field for a name,
 * email, phone or street.
 *
 * @module apps/api/src/oms/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

export class DryRunBasketLineDto {
  @ApiProperty({ description: 'Internal product variant id the line asks for.' })
  @IsString()
  @IsNotEmpty()
  productVariantId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class DryRunBasketDto {
  @ApiProperty({ type: [DryRunBasketLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DryRunBasketLineDto)
  lines!: DryRunBasketLineDto[];

  @ApiProperty({ description: 'Delivery country, ISO 3166-1 alpha-2.', example: 'PL' })
  @IsString()
  @Length(2, 2)
  countryIso2!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional({ description: "The source's own delivery-method id; opaque." })
  @IsOptional()
  @IsString()
  deliveryMethod?: string;
}

export class DraftRuleDto {
  @ApiProperty({
    description:
      'Label the explanation will cite. An existing rule keeps its id; a new draft rule may use any non-empty string.',
  })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ description: 'Ascending evaluation order.' })
  @IsNumber()
  position!: number;

  @ApiProperty({ example: 'filter' })
  @IsString()
  kind!: string;

  @ApiProperty({ example: 'in-stock' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'quantity-split' })
  @IsString()
  afterAction!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  priorityLocationIds?: string[];
}

export class RoutingDryRunRequestDto {
  @ApiPropertyOptional({
    description: 'An ingested order to test. Mutually exclusive with `basket`.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orderId?: string;

  @ApiPropertyOptional({ type: DryRunBasketDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DryRunBasketDto)
  basket?: DryRunBasketDto;

  @ApiPropertyOptional({
    type: [DraftRuleDto],
    description:
      'An UNSAVED ruleset. When present the same order is evaluated twice - once with the saved ' +
      'rules, once with this list - and the lines that differ are reported. Never persisted.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DraftRuleDto)
  draftRules?: DraftRuleDto[];
}
