/**
 * Allegro Quantity Command Response DTO
 *
 * Response DTO for Allegro quantity command operations. Maps domain entity to API response
 * format with all fields exposed.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AllegroQuantityCommand } from '@openlinker/integrations-allegro';

export class AllegroQuantityCommandResponseDto {
  @ApiProperty({
    description: 'Command record ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({ description: 'Allegro command ID', example: 'abc123-def456' })
  commandId!: string;

  @ApiProperty({
    description: 'Connection ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  connectionId!: string;

  @ApiProperty({ description: 'Allegro offer ID', example: 'offer-123' })
  offerId!: string;

  @ApiProperty({ description: 'Quantity value', example: 100 })
  quantity!: number;

  @ApiProperty({
    description: 'Command status',
    enum: ['queued', 'accepted', 'rejected', 'failed'],
    example: 'accepted',
  })
  status!: string;

  @ApiPropertyOptional({
    description: 'Error message (if status is failed or rejected)',
    example: 'Invalid offer ID',
  })
  error?: string | null;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: Date;

  static fromDomain(command: AllegroQuantityCommand): AllegroQuantityCommandResponseDto {
    const dto = new AllegroQuantityCommandResponseDto();
    dto.id = command.id;
    dto.commandId = command.commandId;
    dto.connectionId = command.connectionId;
    dto.offerId = command.offerId;
    dto.quantity = command.quantity;
    dto.status = command.status;
    dto.error = command.error;
    dto.createdAt = command.createdAt;
    dto.updatedAt = command.updatedAt;
    return dto;
  }
}
