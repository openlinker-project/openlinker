/**
 * Subiekt Bank Account Response DTO (#1324)
 *
 * Owner-aware bank-account row returned by
 * `GET /integrations/subiekt/connections/:connectionId/bank-accounts`. Unlike
 * the neutral capability-generic `BankAccountResponseDto` served by
 * `InvoicingController`, this Subiekt-specific shape carries the owning seller
 * Podmiot (`ownerPodmiotId`/`ownerName`) so the FE can group accounts by payer
 * and surface the >1-owner payer-routing warning (decision 6).
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class SubiektBankAccountResponseDto {
  @ApiProperty({ description: 'Bank account id (bridge-native, surfaced as a string)' })
  id!: string;

  @ApiProperty({ description: 'Account number (IBAN/NRB); empty string when the bridge returns none' })
  accountNumber!: string;

  @ApiProperty({ description: 'Bank/account display name; empty string when the bridge returns none' })
  bankName!: string;

  @ApiProperty({ description: "Whether this is the provider's default account" })
  isDefault!: boolean;

  @ApiProperty({ description: 'Owning seller Podmiot id (used to group accounts by payer)' })
  ownerPodmiotId!: number;

  @ApiProperty({
    description: 'Owning seller display name; null when the bridge returns none',
    nullable: true,
    type: String,
  })
  ownerName!: string | null;
}
