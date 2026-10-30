/**
 * Delivery Country Facts Controller (#3907, ADR-079 decision 8)
 *
 * Per-connection read: which delivery countries a source connection's recent
 * orders arrive from, the VAT rates their lines carried, the currency and an
 * anonymous example order. It lets the delivery-line editor show real data
 * beside the curated suggestion.
 *
 * Nested route prefix rather than a second bare `connections` controller - the
 * integrations module owns that prefix (the catalog-trust precedent). The
 * order read goes through `IOrderRecordService`, never a repository port. An
 * unknown connection is a 404 from the connection service.
 *
 * @module apps/api/src/sales-documents/http
 */
import { Controller, Get, HttpCode, HttpStatus, Inject, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IOrderRecordService, ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  CONNECTION_SERVICE_TOKEN,
  IConnectionService,
} from '../../integrations/application/interfaces/connection.service.interface';
import { DeliveryCountryFactsResponseDto } from './dto/delivery-country-facts-response.dto';

/** The look-back the facts cover; travels in the response so a surface never hardcodes it. */
export const DELIVERY_COUNTRY_FACTS_WINDOW_DAYS = 30;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

@ApiBearerAuth()
@ApiTags('sales-documents')
@Controller('connections/:connectionId/delivery-line')
export class DeliveryCountryFactsController {
  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connections: IConnectionService,
  ) {}

  @Get('country-facts')
  @Roles('admin', 'operator', 'viewer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delivery-country facts for one source connection',
    description:
      'Per delivery country over the last 30 days: order count, line VAT rates seen (most ' +
      'frequent first), most frequent currency and one anonymous example order. Carries no buyer ' +
      'name, email or address. Most orders first, at most 20 countries. Read-only.',
  })
  @ApiResponse({ status: 200, type: DeliveryCountryFactsResponseDto })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getCountryFacts(
    @Param('connectionId') connectionId: string,
  ): Promise<DeliveryCountryFactsResponseDto> {
    // Throws a 404 for an unknown connection before any order is read.
    await this.connections.get(connectionId);

    const since = new Date(Date.now() - DELIVERY_COUNTRY_FACTS_WINDOW_DAYS * MILLISECONDS_PER_DAY);
    const facts = await this.orderRecords.getDeliveryCountryFacts(connectionId, since);

    return {
      windowDays: DELIVERY_COUNTRY_FACTS_WINDOW_DAYS,
      countries: facts.map((fact) => ({
        country: fact.country,
        orders30d: fact.orders,
        ratesSeen: [...fact.ratesSeen],
        currency: fact.currency,
        example:
          fact.example === null
            ? null
            : {
                lines: fact.example.lines.map((line) => ({
                  name: line.name,
                  gross: line.gross,
                  rate: line.rate,
                })),
                delivery: fact.example.delivery,
              },
      })),
    };
  }
}
