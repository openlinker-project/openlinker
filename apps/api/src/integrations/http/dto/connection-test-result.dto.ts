/**
 * Connection Test Result DTO
 *
 * Response shape for `POST /connections/:id/test`. Mirrors the core
 * `ConnectionTestResult` type so the FE can render pass/fail + latency.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConnectionTestResult } from '@openlinker/core/integrations';

export class ConnectionTestResultDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiPropertyOptional({ example: 200 })
  status?: number;

  @ApiProperty({ example: 'OK' })
  message!: string;

  @ApiProperty({ example: 342 })
  latencyMs!: number;

  static fromDomain(result: ConnectionTestResult): ConnectionTestResultDto {
    const dto = new ConnectionTestResultDto();
    dto.success = result.success;
    dto.status = result.status;
    dto.message = result.message;
    dto.latencyMs = result.latencyMs;
    return dto;
  }
}
