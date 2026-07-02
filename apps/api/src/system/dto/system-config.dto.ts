/**
 * System Config DTO
 *
 * Response shape for GET /system/config. Exposes server-driven flags
 * that the frontend reads once at startup (staleTime: Infinity).
 *
 * @module apps/api/src/system/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class SystemConfigDto {
  @ApiProperty({ description: 'True when OL_DEMO_MODE=true is set in the environment.' })
  demoMode!: boolean;
}
