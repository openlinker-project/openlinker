/**
 * Buyer Emails Controller tests (#3555)
 *
 * The test send's error mapping and its per-user rate limit.
 *
 * @module apps/api/src/orders/http
 */
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { IBuyerEmailNotificationService } from '@openlinker/core/orders';
import { InMemoryCacheAdapter } from '@openlinker/shared/cache/testing';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { BUYER_EMAIL_TEST_SEND_LIMIT, BuyerEmailsController } from './buyer-emails.controller';
import type { SendBuyerEmailTestDto } from './dto/send-buyer-email-test.dto';

const DTO: SendBuyerEmailTestDto = {
  connectionId: '6f1c7d3e-0d5a-4c3b-9b1e-2a8f4e6d7c90',
  templateKey: 'shipped',
  to: ' me@shop.pl ',
  subject: 'Shipped SHOP-4821',
  body: 'Hello',
};

function user(id: string): AuthenticatedUser {
  return { id, username: id, role: 'admin' } as AuthenticatedUser;
}

describe('BuyerEmailsController', () => {
  let sendTest: jest.Mock;
  let controller: BuyerEmailsController;

  beforeEach(() => {
    sendTest = jest.fn().mockResolvedValue({ status: 'sent' });
    const service = { sendTest } as unknown as IBuyerEmailNotificationService;
    controller = new BuyerEmailsController(service, new InMemoryCacheAdapter());
  });

  it('should send the given text to the trimmed address', async () => {
    await expect(controller.sendTest(DTO, user('u-1'))).resolves.toEqual({ status: 'sent' });
    expect(sendTest).toHaveBeenCalledWith({
      connectionId: DTO.connectionId,
      templateKey: 'shipped',
      to: 'me@shop.pl',
      subject: 'Shipped SHOP-4821',
      text: 'Hello',
    });
  });

  it('should answer 404 when the connection is not found', async () => {
    sendTest.mockResolvedValue({
      status: 'refused',
      reason: 'connection-not-found',
      message: 'gone',
    });

    await expect(controller.sendTest(DTO, user('u-1'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should answer 429 once a user exceeds the test-send limit, without sending', async () => {
    for (let i = 0; i < BUYER_EMAIL_TEST_SEND_LIMIT; i += 1) {
      await controller.sendTest(DTO, user('u-1'));
    }
    sendTest.mockClear();

    const refusal = controller.sendTest(DTO, user('u-1'));
    await expect(refusal).rejects.toBeInstanceOf(HttpException);
    await expect(refusal).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(sendTest).not.toHaveBeenCalled();
  });

  it('should count the limit per user', async () => {
    for (let i = 0; i < BUYER_EMAIL_TEST_SEND_LIMIT; i += 1) {
      await controller.sendTest(DTO, user('u-1'));
    }

    await expect(controller.sendTest(DTO, user('u-2'))).resolves.toEqual({ status: 'sent' });
  });
});
