import type { ModuleRef } from '@nestjs/core';
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { MailerPort } from '@openlinker/core/users';
import type { BuyerEmailDeliveryRepositoryPort } from '../../domain/ports/buyer-email-delivery-repository.port';
import { BuyerEmailDelivery } from '../../domain/entities/buyer-email-delivery.entity';
import { BuyerEmailNotificationService } from './buyer-email-notification.service';

const connection = (config: Record<string, unknown>, enabledCapabilities: string[]): Connection =>
  ({ id: 'conn-1', config, enabledCapabilities }) as unknown as Connection;

const optedIn = {
  buyerEmails: {
    enabled: true,
    templates: { shipped: { enabled: true, replyTo: 'help@shop.pl' } },
  },
};

describe('BuyerEmailNotificationService', () => {
  let repository: jest.Mocked<BuyerEmailDeliveryRepositoryPort>;
  let connections: jest.Mocked<Pick<ConnectionPort, 'get'>>;
  let mailer: jest.Mocked<MailerPort>;
  let service: BuyerEmailNotificationService;

  const input = {
    internalOrderId: 'ol_order_1',
    connectionId: 'conn-1',
    templateKey: 'shipped' as const,
    subjectRef: 'ol_order_1',
    recipient: 'buyer@allegromail.pl',
    subject: 'Shipped',
    text: 'Your parcel is on its way',
  };

  beforeEach(() => {
    const delivery = (
      row: {
        internalOrderId: string;
        connectionId: string;
        subjectRef: string;
        recipient: string | null;
      },
      outcome: 'pending' | 'suppressed'
    ): BuyerEmailDelivery =>
      new BuyerEmailDelivery(
        'd-1',
        row.internalOrderId,
        row.connectionId,
        'shipped',
        row.subjectRef,
        outcome,
        null,
        row.recipient,
        new Date()
      );
    repository = {
      recordSuppression: jest.fn((row) => Promise.resolve(delivery(row, 'suppressed'))),
      claimSend: jest.fn((row) => Promise.resolve(delivery(row, 'pending'))),
      settleClaim: jest.fn().mockResolvedValue(undefined),
      releaseClaim: jest.fn().mockResolvedValue(undefined),
      listByOrder: jest.fn(),
    };
    connections = { get: jest.fn() };
    mailer = { sendEmail: jest.fn() };
    const moduleRef = { get: jest.fn(() => mailer) } as unknown as ModuleRef;
    service = new BuyerEmailNotificationService(
      repository,
      connections as unknown as ConnectionPort,
      moduleRef
    );
  });

  it('should send nothing and record suppressed when the connection has not opted in', async () => {
    connections.get.mockResolvedValue(connection({}, ['OfferManager']));

    const result = await service.send(input);

    expect(result).toMatchObject({ status: 'suppressed', reason: 'emails-off-for-connection' });
    expect(mailer.sendEmail).not.toHaveBeenCalled();
    expect(repository.claimSend).not.toHaveBeenCalled();
    expect(repository.recordSuppression).toHaveBeenCalledWith(
      expect.objectContaining({ suppressionReason: 'emails-off-for-connection' })
    );
  });

  it('should claim the slot, send with the per-template reply-to and settle it as sent', async () => {
    connections.get.mockResolvedValue(connection(optedIn, ['OfferManager']));

    const result = await service.send(input);

    expect(result).toEqual({ status: 'sent', deliveryId: 'd-1' });
    expect(repository.claimSend).toHaveBeenCalledTimes(1);
    expect(mailer.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: input.recipient, replyTo: 'help@shop.pl' })
    );
    expect(repository.settleClaim).toHaveBeenCalledWith('d-1', 'sent');
    expect(repository.claimSend.mock.invocationCallOrder[0]).toBeLessThan(
      mailer.sendEmail.mock.invocationCallOrder[0]
    );
  });

  it('should record bounced when the mail server refuses the recipient', async () => {
    connections.get.mockResolvedValue(connection(optedIn, ['OfferManager']));
    mailer.sendEmail.mockRejectedValue(
      Object.assign(new Error('550 no such user'), { responseCode: 550, command: 'RCPT TO' })
    );

    const result = await service.send(input);

    expect(result.status).toBe('bounced');
    expect(repository.settleClaim).toHaveBeenCalledWith('d-1', 'bounced');
    expect(repository.releaseClaim).not.toHaveBeenCalled();
  });

  it('should not send when the subject slot is already held', async () => {
    connections.get.mockResolvedValue(connection(optedIn, ['OfferManager']));
    repository.claimSend.mockResolvedValue(null);

    const result = await service.send(input);

    expect(result).toMatchObject({ status: 'suppressed', reason: 'already-sent' });
    expect(mailer.sendEmail).not.toHaveBeenCalled();
    expect(repository.recordSuppression).toHaveBeenCalledWith(
      expect.objectContaining({ suppressionReason: 'already-sent' })
    );
  });

  it('should release the slot when the transport is unreachable', async () => {
    connections.get.mockResolvedValue(connection(optedIn, ['OfferManager']));
    mailer.sendEmail.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await service.send(input);

    expect(result.status).toBe('failed');
    expect(repository.releaseClaim).toHaveBeenCalledWith('d-1');
    expect(repository.settleClaim).not.toHaveBeenCalled();
  });

  it('should still report sent when settling the claim fails, since the email has gone', async () => {
    connections.get.mockResolvedValue(connection(optedIn, ['OfferManager']));
    repository.settleClaim.mockRejectedValue(new Error('db down'));

    const result = await service.send(input);

    expect(result).toEqual({ status: 'sent', deliveryId: 'd-1' });
  });
});

describe('BuyerEmailNotificationService.sendTest (#3555)', () => {
  const testInput = {
    connectionId: 'conn-1',
    templateKey: 'shipped' as const,
    to: 'me@shop.pl',
    subject: 'Test',
    text: 'Body',
  };
  let connections: jest.Mocked<Pick<ConnectionPort, 'get'>>;
  let mailer: jest.Mocked<MailerPort>;
  let repository: jest.Mocked<BuyerEmailDeliveryRepositoryPort>;
  let service: BuyerEmailNotificationService;

  beforeEach(() => {
    connections = { get: jest.fn() };
    mailer = { sendEmail: jest.fn() };
    repository = {
      recordSuppression: jest.fn(),
      claimSend: jest.fn(),
      settleClaim: jest.fn(),
      releaseClaim: jest.fn(),
      listByOrder: jest.fn(),
    };
    service = new BuyerEmailNotificationService(
      repository,
      connections as unknown as ConnectionPort,
      { get: jest.fn(() => mailer) } as unknown as ModuleRef
    );
  });

  it('should send with the template sender even when the connection has not opted in', async () => {
    connections.get.mockResolvedValue(
      connection(
        {
          buyerEmails: {
            enabled: false,
            templates: { shipped: { enabled: false, fromAddress: 'shop@x.pl' } },
          },
        },
        ['ProductMaster']
      )
    );

    const result = await service.sendTest(testInput);

    expect(result).toEqual({ status: 'sent' });
    expect(mailer.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'me@shop.pl', from: 'shop@x.pl' })
    );
    expect(repository.claimSend).not.toHaveBeenCalled();
    expect(repository.recordSuppression).not.toHaveBeenCalled();
  });

  it('should refuse an address that is not a single email', async () => {
    const result = await service.sendTest({ ...testInput, to: 'a@b.pl, c@d.pl' });

    expect(result).toMatchObject({ status: 'refused', reason: 'invalid-address' });
    expect(mailer.sendEmail).not.toHaveBeenCalled();
  });

  it('should answer failed without the transport message when the send throws', async () => {
    connections.get.mockResolvedValue(connection({}, ['ProductMaster']));
    mailer.sendEmail.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:587'));

    const result = await service.sendTest(testInput);

    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
  });
});
