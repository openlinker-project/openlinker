/**
 * Order Refund Observation Service
 *
 * Turns a refund a source channel made into an OL refund record. Direction rule
 * (ADR-056): this only OBSERVES - it never asks the channel to do anything, and
 * the record is stamped `operator_out_of_band` because a human moved the money
 * outside OpenLinker.
 *
 * Idempotency is the key `observed:{connectionId}:{externalRefundId}`, enforced
 * by `OrderRefundService.recordRefund` under the per-order lock, so a re-poll
 * writes nothing. A refund OL executed itself cannot be echoed here today: no
 * source adapter implements both `RefundSourceReader` and `RefundExecutor`
 * (Shopify executes as a destination, Allegro only observes), so the two never
 * describe one movement of money. When an adapter ever does both, its executor
 * must record under the same `observed:` key so the echo dedupes.
 *
 * @module application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import type { OrderSourcePort } from '../../domain/ports/order-source.port';
import { isRefundSourceReader } from '../../domain/ports/capabilities/refund-source-reader.capability';
import { PAYMENT_STATUS } from '../../domain/types/payment-status.types';
import { DuplicateRefundRecordException } from '../../domain/exceptions/duplicate-refund-record.exception';
import { ORDER_RECORD_SERVICE_TOKEN, ORDER_REFUND_SERVICE_TOKEN } from '../../orders.tokens';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { IOrderRefundService } from '../interfaces/order-refund.service.interface';
import type {
  IOrderRefundObservationService,
  RefundObservationResult,
} from '../interfaces/order-refund-observation.service.interface';

const NO_OBSERVATION: RefundObservationResult = {
  observed: 0,
  recorded: 0,
  alreadyRecorded: 0,
  rejected: 0,
};

export function buildObservedRefundIdempotencyKey(
  connectionId: string,
  externalRefundId: string
): string {
  return `observed:${connectionId}:${externalRefundId}`;
}

@Injectable()
export class OrderRefundObservationService implements IOrderRefundObservationService {
  private readonly logger = new Logger(OrderRefundObservationService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(ORDER_REFUND_SERVICE_TOKEN)
    private readonly refunds: IOrderRefundService
  ) {}

  async observeSourceRefunds(
    connectionId: string,
    externalOrderId: string
  ): Promise<RefundObservationResult> {
    const internalOrderId = await this.identifierMapping.getInternalId(
      CORE_ENTITY_TYPE.Order,
      externalOrderId,
      connectionId
    );
    if (!internalOrderId) return NO_OBSERVATION;

    const record = await this.orderRecords.getOrderRecord(internalOrderId);
    // Only the order's own source can state its refunds, and only a paid order
    // can have any: this is what keeps the extra channel call off the unpaid
    // and cross-origin (destination echo) paths.
    if (
      !record ||
      record.sourceConnectionId !== connectionId ||
      (record.paymentStatus !== PAYMENT_STATUS.Paid &&
        record.paymentStatus !== PAYMENT_STATUS.Refunded)
    ) {
      return NO_OBSERVATION;
    }

    const orderSource = await this.integrationsService.getCapabilityAdapter<OrderSourcePort>(
      connectionId,
      'OrderSource'
    );
    if (!isRefundSourceReader(orderSource)) return NO_OBSERVATION;

    const observations = await orderSource.listRefunds({ externalOrderId });
    const result: RefundObservationResult = { ...NO_OBSERVATION, observed: observations.length };

    for (const observation of observations) {
      try {
        await this.refunds.recordRefund({
          internalOrderId,
          amount: observation.amount,
          currency: observation.currency,
          reason: 'other',
          note: `Observed on the source channel (refund ${observation.externalRefundId})`,
          recordedAt: observation.occurredAt ?? new Date(),
          idempotencyKey: buildObservedRefundIdempotencyKey(
            connectionId,
            observation.externalRefundId
          ),
          executedBy: 'operator_out_of_band',
          // The money already left: a ceiling is a guard on OL's own writes, and
          // refusing a fact the channel already made would only hide it.
          acknowledgeAboveCeiling: true,
        });
        result.recorded += 1;
      } catch (error) {
        if (error instanceof DuplicateRefundRecordException) {
          result.alreadyRecorded += 1;
          continue;
        }
        // One unrecordable refund (e.g. a currency differing from an earlier
        // record) must not stop the others from being observed.
        result.rejected += 1;
        this.logger.warn(
          `Could not record observed refund ${observation.externalRefundId} for order ${internalOrderId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    return result;
  }
}
