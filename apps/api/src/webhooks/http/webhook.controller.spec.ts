/**
 * Webhook Controller spec
 *
 * Pins the wiring the Shoper token-in-URL auth path depends on: the controller
 * must hand the request's query string, reduced by `readStringQuery`, to
 * `WebhookService.processWebhook`.
 */
import type { Response } from 'express';

import { WebhookController } from './webhook.controller';
import type { RequestWithRawBody } from './middleware/raw-body.middleware';
import type { WebhookService } from '../application/services/webhook.service';

const CONNECTION_ID = '123e4567-e89b-12d3-a456-426614174000';

describe('WebhookController', () => {
  function setup(): { controller: WebhookController; processWebhook: jest.Mock } {
    const processWebhook = jest.fn().mockResolvedValue(undefined);
    const controller = new WebhookController({ processWebhook } as unknown as WebhookService);
    return { controller, processWebhook };
  }

  const res = { status: jest.fn() } as unknown as Response;
  const req = (rawBody: Buffer): RequestWithRawBody => ({ rawBody }) as unknown as RequestWithRawBody;

  it('should pass the string query values to processWebhook, keeping only the first of a repeated key', async () => {
    const { controller, processWebhook } = setup();
    const rawBody = Buffer.from('{}');
    const headers = { 'x-test': '1' };

    await controller.receiveWebhook(
      'shoper',
      CONNECTION_ID,
      headers,
      { token: ['first', 'second'], nested: { a: 'b' } },
      req(rawBody),
      res,
    );

    expect(processWebhook).toHaveBeenCalledWith('shoper', CONNECTION_ID, rawBody, headers, { token: 'first' });
  });

  it('should pass an empty query object when the request carries none', async () => {
    const { controller, processWebhook } = setup();
    const rawBody = Buffer.from('{}');

    await controller.receiveWebhook('prestashop', CONNECTION_ID, {}, {}, req(rawBody), res);

    expect(processWebhook).toHaveBeenCalledWith('prestashop', CONNECTION_ID, rawBody, {}, {});
  });
});
