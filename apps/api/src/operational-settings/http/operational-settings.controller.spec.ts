/**
 * Operational Settings Controller Spec
 *
 * Covers the read projection (values with their provenance, plus the bounds
 * block the form derives its limits from) and the domain-exception mapping on
 * the write path.
 *
 * @module apps/api/src/operational-settings/http
 */
import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import {
  InvalidOperationalSettingError,
  type IOperationalSettingsService,
  type OperationalSettingsView,
} from '@openlinker/core/operational-settings';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { OperationalSettingsController } from './operational-settings.controller';

const view = (overrides: Partial<OperationalSettingsView> = {}): OperationalSettingsView => ({
  catalogueSweepBudget: { value: 500, source: 'default' },
  inventorySweepBudget: { value: 100, source: 'default' },
  sweepPageSize: { value: 100, source: 'default' },
  deletionAuditBudget: { value: 100, source: 'default' },
  deletionAuditCadence: { value: '0 * * * *', source: 'default' },
  deletionAuditAlwaysEnabled: true,
  updatedAt: null,
  updatedBy: null,
  ...overrides,
});

describe('OperationalSettingsController', () => {
  let settings: jest.Mocked<IOperationalSettingsService>;
  let controller: OperationalSettingsController;
  let res: Response;

  beforeEach(() => {
    settings = {
      resolve: jest.fn().mockResolvedValue(view()),
      updateSettings: jest.fn().mockResolvedValue(undefined),
    };
    controller = new OperationalSettingsController(settings);
    res = { setHeader: jest.fn() } as unknown as Response;
  });

  describe('get', () => {
    it('should return every value with the rung that produced it', async () => {
      const dto = await controller.get(res);

      expect(dto.catalogueSweepBudget).toEqual({ value: 500, source: 'default' });
      expect(dto.deletionAuditCadence).toEqual({ value: '0 * * * *', source: 'default' });
    });

    it('should return the bounds a PUT would enforce, so no client restates them', async () => {
      const dto = await controller.get(res);

      expect(dto.bounds.catalogueSweepBudget).toEqual({
        min: 1,
        max: 2000,
        default: 500,
        envVar: 'OL_PRODUCT_SYNC_PAGE_LIMIT',
      });
      expect(dto.bounds.sweepPageSize.max).toBe(100);
    });

    it('should state that the deletion audit cannot be disabled here', async () => {
      const dto = await controller.get(res);

      expect(dto.deletionAuditAlwaysEnabled).toBe(true);
    });

    it('should state when a cadence change applies rather than implying it is immediate', async () => {
      const dto = await controller.get(res);

      expect(dto.cadenceAppliesAt).toBe('next-scheduler-start');
    });

    it('should serialise the row stamp as ISO when a row exists', async () => {
      settings.resolve.mockResolvedValue(
        view({ updatedAt: new Date('2026-08-27T09:00:00.000Z'), updatedBy: 'ada' })
      );

      const dto = await controller.get(res);

      expect(dto.updatedAt).toBe('2026-08-27T09:00:00.000Z');
      expect(dto.updatedBy).toBe('ada');
    });

    it('should never allow the response to be cached', async () => {
      await controller.get(res);

      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });

  describe('update', () => {
    it('should forward the partial update and the actor', async () => {
      await controller.update(
        { catalogueSweepBudget: 750 },
        { id: 'user-1' } as AuthenticatedUser,
        res
      );

      expect(settings.updateSettings).toHaveBeenCalledWith(
        {
          catalogueSweepBudget: 750,
          inventorySweepBudget: undefined,
          sweepPageSize: undefined,
          deletionAuditBudget: undefined,
          deletionAuditCadence: undefined,
        },
        'user-1'
      );
    });

    it('should map a domain bounds violation to 400 naming the field', async () => {
      settings.updateSettings.mockRejectedValue(
        new InvalidOperationalSettingError(
          'catalogueSweepBudget',
          'catalogueSweepBudget must be an integer between 1 and 2000'
        )
      );

      await expect(
        controller.update({ catalogueSweepBudget: 5000 }, {} as AuthenticatedUser, res)
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should let an unrelated error through rather than mislabelling it a bad request', async () => {
      settings.updateSettings.mockRejectedValue(new Error('database unavailable'));

      await expect(
        controller.update({ catalogueSweepBudget: 750 }, {} as AuthenticatedUser, res)
      ).rejects.toThrow('database unavailable');
    });
  });
});
