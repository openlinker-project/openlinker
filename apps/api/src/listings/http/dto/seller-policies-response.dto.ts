/**
 * Seller Policies Response DTO
 *
 * Response shape for `GET /listings/connections/:connectionId/seller-policies`.
 * Swagger-decorated mirror of `SellerPolicies` from `@openlinker/core/integrations`.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class SellerPolicyDto {
  @ApiProperty({ description: 'Platform-native policy id' })
  id!: string;

  @ApiProperty({ description: 'Operator-facing label' })
  name!: string;
}

export class SellerPoliciesResponseDto {
  @ApiProperty({ type: [SellerPolicyDto] })
  deliveryPolicies!: SellerPolicyDto[];

  @ApiProperty({ type: [SellerPolicyDto] })
  returnPolicies!: SellerPolicyDto[];

  @ApiProperty({ type: [SellerPolicyDto] })
  warranties!: SellerPolicyDto[];

  @ApiProperty({ type: [SellerPolicyDto] })
  impliedWarranties!: SellerPolicyDto[];
}
