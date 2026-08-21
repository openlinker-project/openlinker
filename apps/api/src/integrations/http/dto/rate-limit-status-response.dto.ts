/**
 * Rate Limit Status Response DTO
 *
 * Body for `GET /connections/:id/rate-limit-status` — the live, in-memory
 * outbound pacing status for ANY connection (platform-neutral, #1810 Phase 4
 * rebase of the PrestaShop-only #1815 prerequisite). Backed by the shared
 * `RateLimiterRegistry` (`@openlinker/shared/rate-limit`), the same registry
 * `HttpTransportFactory` paces against — never a platform-specific one.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  ResolveConcurrencySourceValues,
  type ResolveConcurrencyCeiling,
} from '@openlinker/core/listings';
import type { EffectiveRateLimitStatus } from '../../application/types/rate-limit-status.types';

/**
 * Ceiling the connection's category-resolve path enforces (#2229), declared by
 * its own adapter. Present independently of `enabled` — it is applied below
 * the shared limiter, so `enabled: false` says nothing about it.
 */
export class ResolveConcurrencyResponseDto {
  @ApiProperty({ type: Number })
  maxInFlight!: number;

  @ApiProperty({ enum: ResolveConcurrencySourceValues })
  source!: ResolveConcurrencyCeiling['source'];

  @ApiProperty({ type: Number })
  adapterDefault!: number;
}

export class RateLimitStatusResponseDto {
  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({ type: Number, required: false })
  requestsPerMinute?: number;

  @ApiProperty({ type: Number, required: false })
  maxConcurrent?: number;

  @ApiProperty({ type: Number, required: false })
  inFlight?: number;

  @ApiProperty({ type: Number, required: false })
  queued?: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  lastAcquiredAt?: string | null;

  @ApiProperty({ type: ResolveConcurrencyResponseDto, required: false })
  resolveConcurrency?: ResolveConcurrencyResponseDto;

  static fromDomain(status: EffectiveRateLimitStatus): RateLimitStatusResponseDto {
    const dto = new RateLimitStatusResponseDto();
    dto.enabled = status.enabled;
    dto.requestsPerMinute = status.requestsPerMinute;
    dto.maxConcurrent = status.maxConcurrent;
    dto.inFlight = status.inFlight;
    dto.queued = status.queued;
    dto.lastAcquiredAt = status.lastAcquiredAt ? status.lastAcquiredAt.toISOString() : undefined;
    dto.resolveConcurrency = status.resolveConcurrency;
    return dto;
  }
}
