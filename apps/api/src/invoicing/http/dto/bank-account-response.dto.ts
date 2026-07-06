/**
 * Bank Account Response DTO
 *
 * Single entry returned by `GET /connections/:connectionId/bank-accounts`
 * (#1303 follow-up). Mirrors the neutral `InvoicingBankAccount` shape from
 * `@openlinker/core/invoicing`.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class BankAccountResponseDto {
  @ApiProperty({ description: 'Provider-native bank account id' })
  id!: string;

  @ApiProperty({ description: 'Bank account number' })
  accountNumber!: string;

  @ApiProperty({ description: 'Bank name' })
  bankName!: string;

  @ApiProperty({ description: "Whether the provider marks this as the seller's default account" })
  isDefault!: boolean;
}
