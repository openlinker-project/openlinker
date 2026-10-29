import type { ModuleRef } from '@nestjs/core';
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { MailerPort } from '@openlinker/core/users';
import type { BuyerEmailDeliveryRepositoryPort } from '../../domain/ports/buyer-email-delivery-repository.port';
import { BuyerEmailDelivery } from '../../domain/entities/buyer-email-delivery.entity';
import { BuyerEmailNotificationService, channelKindOf } from './buyer-email-notification.service';

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
    repository = {
      record: jest.fn((row) =>
        Promise.resolve(
          new BuyerEmailDelivery(
            'd-1',
            row.internalOrderId,
            row.connectionId,
            row.templateKey,
            row.subjectRef,
            row.outcome,
            row.suppressionReason,
            row.recipient,
            new Date()
          )
        )
      ),
      hasSent: jest.fn().mockResolvedValue(false),
      markBounced: jest.fn(),
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
    expect(repository.record).toHaveBeenCalledTimes(1);
    expect(repository.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'suppressed' })
    );
  });

  it('should send with the per-template reply-to and record one sent row when opted in', async () => {
    connections.get.mockResolvedValue(connection(optedIn, ['OfferManager']));

    const result = await service.send(input);

    expect(result).toEqual({ status: 'sent', deliveryId: 'd-1' });
    expect(mailer.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: input.recipient, replyTo: 'help@shop.pl' })
    );
    expect(repository.record).toHaveBeenCalledTimes(1);
    expect(repository.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'sent' }));
  });

  it('should record bounced when the mail server refuses the recipient', async () => {
    connections.get.mockResolvedValue(connection(optedIn, ['OfferManager']));
    mailer.sendEmail.mockRejectedValue(
      Object.assign(new Error('550 no such user'), { responseCode: 550, command: 'RCPT TO' })
    );

    const result = await service.send(input);

    expect(result.status).toBe('bounced');
    expect(repository.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'bounced' }));
  });

  it('should not send twice for the same subject', async () => {
    connections.get.mockResolvedValue(connection(optedIn, ['OfferManager']));
    repository.hasSent.mockResolvedValue(true);

    const result = await service.send(input);

    expect(result).toMatchObject({ status: 'suppressed', reason: 'already-sent' });
    expect(mailer.sendEmail).not.toHaveBeenCalled();
  });

  it('should record nothing when the transport is unreachable', async () => {
    connections.get.mockResolvedValue(connection(optedIn, ['OfferManager']));
    mailer.sendEmail.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await service.send(input);

    expect(result.status).toBe('failed');
    expect(repository.record).not.toHaveBeenCalled();
  });
});

describe('channelKindOf', () => {
  it('should read a shop carrying OfferManager and ProductMaster as a shop', () => {
    expect(channelKindOf(['ProductMaster', 'OfferManager'])).toBe('shop');
    expect(channelKindOf(['OfferManager', 'OrderSource'])).toBe('marketplace');
  });
});
