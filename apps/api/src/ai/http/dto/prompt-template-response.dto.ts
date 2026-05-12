/**
 * Prompt Template Response DTO
 *
 * Wire shape of a single template row returned by the list / get /
 * mutation endpoints. Built from the domain entity via
 * `PromptTemplateResponseDto.fromDomain`.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { PromptTemplate } from '@openlinker/core/ai';
import {
  PromptTemplateStateValues,
  PromptTemplateVariableTypeValues,
  type PromptTemplateChannel,
  type PromptTemplateState,
  type PromptTemplateVariable,
} from '@openlinker/core/ai';

class PromptTemplateVariableResponse {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: PromptTemplateVariableTypeValues }) type!: PromptTemplateVariable['type'];
  @ApiProperty() required!: boolean;
  @ApiProperty({ required: false }) description?: string;
}

export class PromptTemplateResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() key!: string;

  @ApiProperty({ type: String, nullable: true, example: 'allegro' })
  channel!: PromptTemplateChannel | null;

  @ApiProperty() version!: number;
  @ApiProperty() systemPrompt!: string;
  @ApiProperty() userPromptTemplate!: string;

  @ApiProperty({ type: [PromptTemplateVariableResponse] })
  variables!: PromptTemplateVariableResponse[];

  @ApiProperty({ enum: PromptTemplateStateValues })
  state!: PromptTemplateState;

  @ApiProperty({ nullable: true }) publishedAt!: string | null;
  @ApiProperty({ nullable: true }) createdBy!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static fromDomain(template: PromptTemplate): PromptTemplateResponseDto {
    const dto = new PromptTemplateResponseDto();
    dto.id = template.id;
    dto.key = template.key;
    dto.channel = template.channel;
    dto.version = template.version;
    dto.systemPrompt = template.systemPrompt;
    dto.userPromptTemplate = template.userPromptTemplate;
    dto.variables = template.variables.map((variable) => ({
      name: variable.name,
      type: variable.type,
      required: variable.required,
      description: variable.description,
    }));
    dto.state = template.state;
    dto.publishedAt = template.publishedAt !== null ? template.publishedAt.toISOString() : null;
    dto.createdBy = template.createdBy;
    dto.createdAt = template.createdAt.toISOString();
    dto.updatedAt = template.updatedAt.toISOString();
    return dto;
  }
}
