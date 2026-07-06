/**
 * Subiekt Cash Register Response DTO (#1324)
 *
 * One Stanowisko Kasowe (cash register) returned by
 * `GET /integrations/subiekt/connections/:connectionId/cash-registers`. This is
 * a Subiekt-local concept with no neutral `libs/core` capability (decision 2) —
 * inFakt/KSeF have no cash-register notion — so the shape stays Subiekt-only.
 *
 * `oddzialId` is an INFORMATIONAL branch tag (a display label): `null` means the
 * register is unlinked; a non-null value is the register's own branch, NOT a
 * per-request routing override.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class SubiektCashRegisterResponseDto {
  @ApiProperty({ description: 'Cash-register id (bridge-native number)' })
  id!: number;

  @ApiProperty({
    description: 'Cash-register display name; null when the bridge returns none',
    nullable: true,
    type: String,
  })
  name!: string | null;

  @ApiProperty({
    description: 'Cash-register symbol; null when the bridge returns none',
    nullable: true,
    type: String,
  })
  symbol!: string | null;

  @ApiProperty({
    description: 'Informational branch (Oddział) tag; null when the register is unlinked',
    nullable: true,
    type: Number,
  })
  oddzialId!: number | null;
}
