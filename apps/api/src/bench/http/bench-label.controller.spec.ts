/**
 * BenchLabelController (#3654)
 */
import type { ArgumentMetadata} from '@nestjs/common';
import { ConflictException, NotFoundException, ValidationPipe, BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { FulfillmentWorkNotFoundError } from '@openlinker/core/fulfillment';

import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type { IBenchLabelService } from '../application/interfaces/bench-label.service.interface';
import { BenchLabelShipmentNotFoundError } from '../application/services/bench-label.service';
import { BenchParcelNotAtThisBenchError } from '../application/services/bench-parcel.service';
import { BenchLabelController } from './bench-label.controller';
import { ReplaceLabelDto } from './dto/replace-label.dto';

const user = { id: 'user-1' } as AuthenticatedUser;

describe('BenchLabelController — POST work/:workId/label/replace (#3654)', () => {
  let labels: jest.Mocked<IBenchLabelService>;
  let controller: BenchLabelController;

  beforeEach(() => {
    labels = {
      replaceLabel: jest.fn(),
      generateLabel: jest.fn(),
    } as jest.Mocked<IBenchLabelService>;
    controller = new BenchLabelController(labels);
  });

  it('should name admin, operator and packer on the route', () => {
    const roles = new Reflector().get<string[]>(ROLES_KEY, BenchLabelController.prototype.replaceLabel);
    expect([...roles].sort()).toEqual(['admin', 'operator', 'packer']);
  });

  describe('body whitelist (the app ValidationPipe config)', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const meta: ArgumentMetadata = { type: 'body', metatype: ReplaceLabelDto };

    it.each([
      [{ recipient: { email: 'x@y.pl' }, weightGrams: 100 }],
      [{ address: 'x', weightGrams: 100 }],
      [{ shipmentId: 'ol_shipment_1', weightGrams: 100 }],
      [{ weightGrams: -1 }],
      [{ weightGrams: 1.5 }],
      [{ template: 'bad template!' }],
    ])('should reject %j with 400', async (body) => {
      await expect(pipe.transform(body, meta)).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      [{ template: 'small' }],
      [{ lengthMm: 1, widthMm: 2, heightMm: 3, weightGrams: 4 }],
      [{ weightGrams: 4 }],
    ])('should accept %j', async (body) => {
      await expect(pipe.transform(body, meta)).resolves.toBeInstanceOf(ReplaceLabelDto);
    });
  });

  it('should refuse a mixed or incomplete parcel shape with 400 before calling the service', async () => {
    for (const dto of [{}, { template: 'a', weightGrams: 5 }, { lengthMm: 1, weightGrams: 5 }] as ReplaceLabelDto[]) {
      await expect(controller.replaceLabel('work-1', dto, user)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(labels.replaceLabel).not.toHaveBeenCalled();
  });

  it('should pass the token user and the parcel, never body identity', async () => {
    labels.replaceLabel.mockResolvedValue({
      outcome: 'replaced', cancelledShipmentId: 'a', newShipmentId: 'b', cancelledAfterDispatch: false,
      keptTemplate: null,
    });
    const res = await controller.replaceLabel('work-1', { template: 'small' } as ReplaceLabelDto, user);
    expect(labels.replaceLabel).toHaveBeenCalledWith({
      workId: 'work-1', parcel: { kind: 'template', template: 'small' }, actorUserId: 'user-1',
    });
    expect(res).toEqual({
      outcome: 'replaced',
      cancelledShipmentId: 'a',
      newShipmentId: 'b',
      cancelledAfterDispatch: false,
      voidState: 'confirmed',
      keptTemplate: null,
    });
  });

  it('should answer cancelled-not-replaced as a result with newShipmentId null', async () => {
    labels.replaceLabel.mockResolvedValue({
      outcome: 'cancelled-not-replaced',
      cancelledShipmentId: 'a',
      cancelledAfterDispatch: true,
      voidState: 'confirmed',
      keptTemplate: 'small',
    });
    const res = await controller.replaceLabel(
      'work-1',
      { weightGrams: 5 } as ReplaceLabelDto,
      user
    );
    expect(res).toEqual({
      outcome: 'cancelled-not-replaced',
      cancelledShipmentId: 'a',
      newShipmentId: null,
      cancelledAfterDispatch: true,
      voidState: 'confirmed',
      keptTemplate: 'small',
    });
  });

  it('should answer an in-doubt void as a 2xx result, never an error', async () => {
    labels.replaceLabel.mockResolvedValue({
      outcome: 'cancelled-not-replaced',
      cancelledShipmentId: 'a',
      cancelledAfterDispatch: false,
      voidState: 'in-doubt',
      keptTemplate: null,
    });
    const res = await controller.replaceLabel(
      'work-1',
      { template: 'small' } as ReplaceLabelDto,
      user
    );
    expect(res).toMatchObject({
      outcome: 'cancelled-not-replaced',
      newShipmentId: null,
      voidState: 'in-doubt',
    });
  });

  it('should answer 409 with the reason for a refusal', async () => {
    labels.replaceLabel.mockResolvedValue({ outcome: 'refused', reason: 'cannot-cancel' });
    const error = await controller.replaceLabel('work-1', { weightGrams: 5 } as ReplaceLabelDto, user).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ reason: 'cannot-cancel' });
  });

  it.each([
    new FulfillmentWorkNotFoundError('w'),
    new BenchParcelNotAtThisBenchError('w'),
    new BenchLabelShipmentNotFoundError('w'),
  ])('should answer 404 for %p', async (err) => {
    labels.replaceLabel.mockRejectedValue(err);
    await expect(controller.replaceLabel('w', { weightGrams: 5 } as ReplaceLabelDto, user)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});

describe('BenchLabelController — POST work/:workId/label (#2729, D46)', () => {
  let labels: jest.Mocked<IBenchLabelService>;
  let controller: BenchLabelController;

  beforeEach(() => {
    labels = {
      replaceLabel: jest.fn(),
      generateLabel: jest.fn(),
    } as jest.Mocked<IBenchLabelService>;
    controller = new BenchLabelController(labels);
  });

  it('should name admin, operator and packer on the route', () => {
    const roles = new Reflector().get<string[]>(ROLES_KEY, BenchLabelController.prototype.generateLabel);
    expect([...roles].sort()).toEqual(['admin', 'operator', 'packer']);
  });

  it('should take no body, so a packer cannot name a parcel, address or shipment', () => {
    // (workId, user): a handler that declared a `@Body()` parameter would be 3.
    expect(BenchLabelController.prototype.generateLabel.length).toBe(2);
  });

  it('should pass the work and the token user, and answer the new shipment id', async () => {
    labels.generateLabel.mockResolvedValue({ outcome: 'generated', shipmentId: 'ship-9' });

    const res = await controller.generateLabel('work-1', user);

    expect(labels.generateLabel).toHaveBeenCalledWith({ workId: 'work-1', actorUserId: 'user-1' });
    expect(res).toEqual({ shipmentId: 'ship-9' });
  });

  it('should answer 409 with the reason, never a body that reads as success, when refused', async () => {
    labels.generateLabel.mockResolvedValue({ outcome: 'refused', reason: 'auto-dispatch-on' });

    await expect(controller.generateLabel('work-1', user)).rejects.toMatchObject({
      response: { reason: 'auto-dispatch-on' },
    });
    await expect(controller.generateLabel('work-1', user)).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([new FulfillmentWorkNotFoundError('w'), new BenchParcelNotAtThisBenchError('w')])(
    'should answer 404 for %p',
    async (err) => {
      labels.generateLabel.mockRejectedValue(err);
      await expect(controller.generateLabel('w', user)).rejects.toBeInstanceOf(NotFoundException);
    }
  );

  it('should refuse a request that carries no principal, because a paid label must name who bought it', async () => {
    await expect(
      controller.generateLabel('work-1', undefined as unknown as AuthenticatedUser)
    ).rejects.toThrow('must name the packer');
    expect(labels.generateLabel).not.toHaveBeenCalled();
  });
});
