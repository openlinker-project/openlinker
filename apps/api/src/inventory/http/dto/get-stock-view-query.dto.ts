/**
 * Get Stock View Query DTO
 *
 * Query shape for `GET /inventory/stock-view` (#3621): one product, whose
 * variants' stock the operator's panel renders.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GetStockViewQueryDto {
  @ApiProperty({ description: 'Internal product id whose variants\' stock is returned.' })
  @IsString()
  @IsNotEmpty()
  productId!: string;
}
