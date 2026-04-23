/**
 * Prompt Template Summary Response DTO
 *
 * Wire shape for the admin list view. One summary per `(key, channel)` pair
 * with enough information to render a row without a follow-up fetch.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  PromptTemplateChannelValues,
  PromptTemplateStateValues,
  type PromptTemplateChannel,
  type PromptTemplateState,
  type PromptTemplateSummary,
} from '@openlinker/core/ai';

export class PromptTemplateSummaryResponseDto {
  @ApiProperty() key!: string;

  @ApiProperty({ enum: PromptTemplateChannelValues, nullable: true })
  channel!: PromptTemplateChannel | null;

  @ApiProperty() latestVersion!: number;
  @ApiProperty() latestId!: string;

  @ApiProperty({ enum: PromptTemplateStateValues })
  latestState!: PromptTemplateState;

  @ApiProperty({ nullable: true }) publishedVersion!: number | null;
  @ApiProperty({ nullable: true }) publishedId!: string | null;
  @ApiProperty() hasDraft!: boolean;
  @ApiProperty() updatedAt!: string;

  static fromDomain(summary: PromptTemplateSummary): PromptTemplateSummaryResponseDto {
    const dto = new PromptTemplateSummaryResponseDto();
    dto.key = summary.key;
    dto.channel = summary.channel;
    dto.latestVersion = summary.latestVersion;
    dto.latestId = summary.latestId;
    dto.latestState = summary.latestState;
    dto.publishedVersion = summary.publishedVersion;
    dto.publishedId = summary.publishedId;
    dto.hasDraft = summary.hasDraft;
    dto.updatedAt = summary.updatedAt.toISOString();
    return dto;
  }
}
