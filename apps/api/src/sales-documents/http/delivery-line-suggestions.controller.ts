/**
 * Delivery-Line Suggestions Controller (#3907, ADR-079 decision 8)
 *
 * Read-only access to the curated per-country delivery-line suggestions that
 * live as data beside the starter-template catalogue. It writes nothing: the
 * editor offers these and the operator decides what to save.
 *
 * @module apps/api/src/sales-documents/http
 */
import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  getDeliveryLineSuggestion,
  listDeliveryLineSuggestions,
  type DeliveryLineSuggestion,
} from '../data/delivery-line-suggestion-catalogue';
import {
  DeliveryLineSuggestionDto,
  DeliveryLineSuggestionsResponseDto,
} from './dto/delivery-line-suggestion-response.dto';

function toDto(suggestion: DeliveryLineSuggestion): DeliveryLineSuggestionDto {
  return {
    country: suggestion.country,
    defaultName: suggestion.defaultName,
    nameSuggestions: [...suggestion.nameSuggestions],
    rateMode: suggestion.rateMode,
    omitFreeDelivery: suggestion.omitFreeDelivery,
    sources: suggestion.sources.map((source) => ({ term: source.term, text: source.text })),
    sourceLabel: suggestion.sourceLabel,
    sourceUrl: suggestion.sourceUrl,
    disclaimer: suggestion.disclaimer,
  };
}

@ApiBearerAuth()
@ApiTags('sales-documents')
@Controller('sales-documents/delivery-line/suggestions')
export class DeliveryLineSuggestionsController {
  @Get()
  @Roles('admin', 'operator', 'viewer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Curated delivery-line suggestions, one per researched country',
    description:
      'Only countries with researched guidance appear; a missing country means there is no ' +
      'suggestion, not that the market is unsupported. Read-only.',
  })
  @ApiResponse({ status: 200, type: DeliveryLineSuggestionsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listSuggestions(): DeliveryLineSuggestionsResponseDto {
    return { suggestions: listDeliveryLineSuggestions().map(toDto) };
  }

  @Get(':country')
  @Roles('admin', 'operator', 'viewer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The delivery-line suggestion for one country' })
  @ApiResponse({ status: 200, type: DeliveryLineSuggestionDto })
  @ApiResponse({ status: 404, description: 'No curated suggestion for this country' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getSuggestion(@Param('country') country: string): DeliveryLineSuggestionDto {
    const suggestion = getDeliveryLineSuggestion(country);
    if (suggestion === null) {
      throw new NotFoundException(`No delivery-line suggestion for country '${country}'`);
    }
    return toDto(suggestion);
  }
}
