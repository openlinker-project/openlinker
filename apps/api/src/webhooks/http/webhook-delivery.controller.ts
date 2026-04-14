/**
 * Webhook Delivery Controller
 *
 * HTTP endpoints for operator visibility into inbound webhook processing.
 * List returns summary rows (no payload); detail returns the full record
 * including the raw payload.
 *
 * @module apps/api/src/webhooks/http
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  IWebhookDeliveryQueryService,
  WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN,
} from '../application/interfaces/webhook-delivery-query.service.interface';
import { ListWebhookDeliveriesQueryDto } from './dto/list-webhook-deliveries-query.dto';
import { PaginatedWebhookDeliveriesResponseDto } from './dto/paginated-webhook-deliveries-response.dto';
import { WebhookDeliveryDetailResponseDto } from './dto/webhook-delivery-detail-response.dto';
import { WebhookDeliverySummaryResponseDto } from './dto/webhook-delivery-summary-response.dto';
import type { WebhookDelivery } from '@openlinker/core/webhooks';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('webhooks')
@Controller('webhook-deliveries')
export class WebhookDeliveryController {
  constructor(
    @Inject(WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN)
    private readonly queryService: IWebhookDeliveryQueryService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List webhook deliveries',
    description:
      'Paginated list of inbound webhook deliveries with filters. Excludes raw payload; use GET /webhook-deliveries/:id for the full record.',
  })
  @ApiResponse({ status: 200, type: PaginatedWebhookDeliveriesResponseDto })
  async list(
    @Query() query: ListWebhookDeliveriesQueryDto,
  ): Promise<PaginatedWebhookDeliveriesResponseDto> {
    const { provider, connectionId, status, since, until, limit = 20, offset = 0 } = query;

    const { items, total } = await this.queryService.list(
      {
        provider,
        connectionId,
        status,
        since: since ? new Date(since) : undefined,
        until: until ? new Date(until) : undefined,
      },
      { limit, offset },
    );

    return {
      items: items.map((d) => this.toSummary(d)),
      total,
      limit,
      offset,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get webhook delivery by id' })
  @ApiResponse({ status: 200, type: WebhookDeliveryDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Delivery not found' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookDeliveryDetailResponseDto> {
    const delivery = await this.queryService.getById(id);
    if (!delivery) {
      throw new NotFoundException(`Webhook delivery not found: ${id}`);
    }
    return this.toDetail(delivery);
  }

  private toSummary(d: WebhookDelivery): WebhookDeliverySummaryResponseDto {
    return {
      id: d.id,
      eventId: d.eventId,
      provider: d.provider,
      connectionId: d.connectionId,
      eventType: d.eventType,
      objectType: d.objectType,
      externalId: d.externalId,
      receivedAt: d.receivedAt.toISOString(),
      signatureValid: d.signatureValid,
      dedupResult: d.dedupResult,
      status: d.status,
      rejectionReason: d.rejectionReason,
      publishedMessageId: d.publishedMessageId,
      downstreamJobId: d.downstreamJobId,
      downstreamJobType: d.downstreamJobType,
      dlqReason: d.dlqReason,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  }

  private toDetail(d: WebhookDelivery): WebhookDeliveryDetailResponseDto {
    return { ...this.toSummary(d), payload: d.payload };
  }
}
