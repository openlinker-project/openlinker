/**
 * Attribute Mapping Rules Controller
 *
 * HTTP REST endpoints for operator-authored attribute mapping rules (#1841),
 * scoped to a destination connection. Read (GET) allows admin/operator/viewer;
 * write (PUT/DELETE) allows admin/operator - mirroring the sibling
 * MappingsController role policy. The flat wire DTO is assembled into the core
 * discriminated `config` union here (rejecting a missing kind-specific field).
 *
 * @module apps/api/src/mappings/http
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  type HttpException,
  HttpStatus,

  Inject,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { codedHttpError } from '../../common/errors/coded-http.exception';
import {
  AttributeMappingRuleNotFoundException,
  IMappingConfigService,
  MAPPING_CONFIG_SERVICE_TOKEN,
  type AttributeMappingRuleConfig,
} from '@openlinker/core/mappings';
import { AttributeRuleInputDto } from './dto/attribute-rule-input.dto';
import { AttributeRuleResponseDto } from './dto/attribute-rule-response.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('mappings')
@Controller('connections/:connectionId/attribute-rules')
export class AttributeMappingRulesController {
  constructor(
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfigService: IMappingConfigService
  ) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'List attribute mapping rules for a connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [AttributeRuleResponseDto] })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async list(@Param('connectionId') connectionId: string): Promise<AttributeRuleResponseDto[]> {
    const rules = await this.mappingConfigService.getAttributeMappingRules(connectionId);
    return rules.map((r) => AttributeRuleResponseDto.fromDomain(r));
  }

  @Put()
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update an attribute mapping rule for a connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: AttributeRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async upsert(
    @Param('connectionId') connectionId: string,
    @Body() dto: AttributeRuleInputDto
  ): Promise<AttributeRuleResponseDto> {
    try {
      const rule = await this.mappingConfigService.upsertAttributeMappingRule(connectionId, {
        id: dto.id,
        destinationParameterName: dto.destinationParameterName,
        config: this.toConfig(dto),
        priority: dto.priority,
        sourceConnectionId: dto.sourceConnectionId ?? null,
        destinationCategoryId: dto.destinationCategoryId ?? null,
        manufacturerMatch: dto.manufacturerMatch ?? null,
        phraseMatch: dto.phraseMatch ?? null,
      });
      return AttributeRuleResponseDto.fromDomain(rule);
    } catch (error) {
      throw this.mapNotFound(error, dto.id);
    }
  }

  @Delete(':ruleId')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an attribute mapping rule' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiParam({ name: 'ruleId', type: String })
  @ApiResponse({ status: 204, description: 'Rule deleted' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async remove(
    @Param('connectionId') connectionId: string,
    @Param('ruleId') ruleId: string
  ): Promise<void> {
    try {
      await this.mappingConfigService.deleteAttributeMappingRule(ruleId, connectionId);
    } catch (error) {
      throw this.mapNotFound(error, ruleId);
    }
  }

  /** Map the domain not-found exception to a 404 at the HTTP boundary. */
  private mapNotFound(error: unknown, ruleId: string | undefined): unknown {
    if (error instanceof AttributeMappingRuleNotFoundException) {
      return codedHttpError(
        HttpStatus.NOT_FOUND,
        'ATTRIBUTE_MAPPING_RULE_NOT_FOUND',
        error.message,
        ruleId !== undefined ? { ruleId } : undefined
      );
    }
    return error;
  }

  private ruleFieldRequired(path: string, message: string): HttpException {
    return codedHttpError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', message, undefined, {
      fields: [{ path, code: 'isNotEmpty' }],
    });
  }

  private toConfig(dto: AttributeRuleInputDto): AttributeMappingRuleConfig {
    switch (dto.kind) {
      case 'fixed':
        if (dto.fixedValue === undefined || dto.fixedValue === '') {
          throw this.ruleFieldRequired(
            'fixedValue',
            'fixedValue must be a non-empty string for a "fixed" rule'
          );
        }
        return { kind: 'fixed', value: dto.fixedValue };
      case 'copy-remap':
        if (!dto.sourceAttributeKey) {
          throw this.ruleFieldRequired(
            'sourceAttributeKey',
            'sourceAttributeKey is required for a "copy-remap" rule'
          );
        }
        return {
          kind: 'copy-remap',
          sourceAttributeKey: dto.sourceAttributeKey,
          valueRemap: (dto.valueRemap ?? []).map((v) => ({
            sourceValue: v.sourceValue,
            destinationValue: v.destinationValue,
          })),
        };
      case 'place-value':
        if (!dto.placeValueSource) {
          throw this.ruleFieldRequired(
            'placeValueSource',
            'placeValueSource is required for a "place-value" rule'
          );
        }
        return { kind: 'place-value', source: dto.placeValueSource };
    }
  }
}
