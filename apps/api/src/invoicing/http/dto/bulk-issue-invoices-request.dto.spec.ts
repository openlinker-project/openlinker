/**
 * Bulk Issue Invoices Request DTO — validation spec (#1355)
 *
 * Exercises the class-validator constraints: a valid connection id + non-empty
 * order-id array passes; an empty array, a blank id, a non-UUID connection id,
 * and a batch over the 100-id cap are rejected.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { BulkIssueInvoicesRequestDto } from './bulk-issue-invoices-request.dto';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';

function buildDto(payload: Record<string, unknown>): BulkIssueInvoicesRequestDto {
  return plainToInstance(BulkIssueInvoicesRequestDto, payload);
}

describe('BulkIssueInvoicesRequestDto', () => {
  it('should pass validation for a connection id and a non-empty order-id array', async () => {
    const dto = buildDto({ connectionId: CONNECTION_ID, orderIds: ['ol_order_1', 'ol_order_2'] });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('should reject an empty order-id array', async () => {
    const dto = buildDto({ connectionId: CONNECTION_ID, orderIds: [] });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('orderIds');
  });

  it('should reject a batch larger than the 100-id cap', async () => {
    const orderIds = Array.from({ length: 101 }, (_, i) => `ol_order_${i}`);
    const dto = buildDto({ connectionId: CONNECTION_ID, orderIds });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('arrayMaxSize');
  });

  it('should reject a blank order id in the array', async () => {
    const dto = buildDto({ connectionId: CONNECTION_ID, orderIds: ['ol_order_1', ''] });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('orderIds');
  });

  it('should reject a non-UUID connection id', async () => {
    const dto = buildDto({ connectionId: 'not-a-uuid', orderIds: ['ol_order_1'] });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('connectionId');
  });
});
