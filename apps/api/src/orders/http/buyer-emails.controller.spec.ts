/**
 * Buyer Emails Controller tests (#3555)
 *
 * How the test send's answer maps onto HTTP. The limit itself is the
 * service's and is pinned in its own spec.
 *
 * @module apps/api/src/orders/http
 */
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { IBuyerEmailNotificationService } from '@openlinker/core/orders';
import type { AuthenticatedUser } from '../../auth/auth.types';
import {
  BUYER_EMAIL_TEST_RATE_LIMITED_ERROR_CODE,
  BuyerEmailsController,
} from './buyer-emails.controller';
import type { SendBuyerEmailTestDto } from './dto/send-buyer-email-test.dto';

const DTO: SendBuyerEmailTestDto = {
  connectionId: '6f1c7d3e-0d5a-4c3b-9b1e-2a8f4e6d7c90',
  templateKey: 'shipped',
  to: ' me@shop.pl ',
  subject: 'Shipped SHOP-4821',
  body: 'Hello',
};

const USER = { id: 'u-1', username: 'u-1', role: 'admin' } as AuthenticatedUser;

describe('BuyerEmailsController', () => {
  let sendTest: jest.Mock;
  let controller: BuyerEmailsController;

  beforeEach(() => {
    sendTest = jest.fn().mockResolvedValue({ status: 'sent' });
    controller = new BuyerEmailsController({ sendTest } as unknown as IBuyerEmailNotificationService);
  });

  it('should send the given text to the trimmed address on behalf of the signed-in user', async () => {
    await expect(controller.sendTest(DTO, USER)).resolves.toEqual({ status: 'sent' });
    expect(sendTest).toHaveBeenCalledWith({
      actorUserId: 'u-1',
      connectionId: DTO.connectionId,
      templateKey: 'shipped',
      to: 'me@shop.pl',
      subject: 'Shipped SHOP-4821',
      text: 'Hello',
    });
  });

  it('should answer 404 when the connection is not found', async () => {
    sendTest.mockResolvedValue({ status: 'refused', reason: 'connection-not-found', message: 'gone' });

    await expect(controller.sendTest(DTO, USER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should answer 429 with a machine code when the service reports the actor is rate-limited', async () => {
    sendTest.mockResolvedValue({ status: 'refused', reason: 'rate-limited', message: 'slow down' });

    const error: unknown = await controller.sendTest(DTO, USER).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((error as HttpException).getResponse()).toEqual({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      code: BUYER_EMAIL_TEST_RATE_LIMITED_ERROR_CODE,
      error: BUYER_EMAIL_TEST_RATE_LIMITED_ERROR_CODE,
      message: 'slow down',
    });
  });

  it('should answer 400 for an address that is not a single email', async () => {
    sendTest.mockResolvedValue({ status: 'refused', reason: 'invalid-address', message: 'one address' });

    await expect(controller.sendTest(DTO, USER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should answer 400 for a template the marketplace connection does not send', async () => {
    sendTest.mockResolvedValue({
      status: 'refused',
      reason: 'template-not-allowed',
      message: 'not on a marketplace',
    });

    await expect(controller.sendTest(DTO, USER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should answer 503 when the send failed', async () => {
    sendTest.mockResolvedValue({ status: 'failed', message: 'could not send' });

    await expect(controller.sendTest(DTO, USER)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('should answer 500, never sent, when the service reports a refusal reason it does not map', async () => {
    sendTest.mockResolvedValue({ status: 'refused', reason: 'something-new', message: 'no' });

    await expect(controller.sendTest(DTO, USER)).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
