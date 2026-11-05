/**
 * GiftRulesController unit tests (#3938)
 *
 * Routes, roles and the error each refusal raises. The rule logic itself is the
 * automation service's and is tested there.
 */
import { NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type {
  IAutomationRulesService,
  IGiftRuleService,
} from '@openlinker/core/automation';
import { AutomationRuleNotFoundError } from '@openlinker/core/automation';
import type { IOrderGiftService, IOrderRecordService } from '@openlinker/core/orders';
import { ROLES_KEY } from '../../../auth/decorators/roles.decorator';
import { GiftRulesController } from '../gift-rules.controller';

const ID = '5f0f7a3e-1b2c-4d5e-8f90-123456789abc';

function build(): {
  controller: GiftRulesController;
  rules: jest.Mocked<IAutomationRulesService>;
  gifts: jest.Mocked<IGiftRuleService>;
  orders: jest.Mocked<IOrderRecordService>;
} {
  const rules = {
    getRule: jest.fn(),
    deleteRule: jest.fn(),
    reorderRules: jest.fn(),
  } as unknown as jest.Mocked<IAutomationRulesService>;
  const gifts = { listGiftRules: jest.fn().mockResolvedValue([]) } as unknown as jest.Mocked<IGiftRuleService>;
  const orders = { getOrderRecord: jest.fn() } as unknown as jest.Mocked<IOrderRecordService>;
  const orderGifts = {} as unknown as IOrderGiftService;
  return { controller: new GiftRulesController(rules, gifts, orderGifts, orders), rules, gifts, orders };
}

const rolesOf = (handler: keyof GiftRulesController): string[] =>
  Reflect.getMetadata(ROLES_KEY, GiftRulesController.prototype[handler]) as string[];
const routeOf = (handler: keyof GiftRulesController): { method: RequestMethod; path: string } => ({
  method: Reflect.getMetadata(METHOD_METADATA, GiftRulesController.prototype[handler]) as RequestMethod,
  path: Reflect.getMetadata(PATH_METADATA, GiftRulesController.prototype[handler]) as string,
});

describe('GiftRulesController', () => {
  it('should mount the routes on the documented verbs and paths', () => {
    expect(routeOf('list')).toEqual({ method: RequestMethod.GET, path: '/' });
    expect(routeOf('reorder')).toEqual({ method: RequestMethod.PUT, path: 'order' });
    expect(routeOf('evaluate')).toEqual({ method: RequestMethod.POST, path: 'evaluate' });
    expect(routeOf('remove')).toEqual({ method: RequestMethod.DELETE, path: ':id' });
    expect(routeOf('resume')).toEqual({ method: RequestMethod.POST, path: ':id/resume' });
  });

  it('should declare reads and the dry run for viewers and writes for admin and operator only', () => {
    expect(rolesOf('list')).toEqual(['admin', 'operator', 'viewer']);
    expect(rolesOf('get')).toEqual(['admin', 'operator', 'viewer']);
    expect(rolesOf('evaluate')).toEqual(['admin', 'operator', 'viewer']);
    for (const write of ['create', 'replace', 'remove', 'resume', 'reorder'] as const) {
      expect(rolesOf(write)).toEqual(['admin', 'operator']);
    }
  });

  it('should never admit the packer role on any route', () => {
    for (const handler of ['list', 'get', 'evaluate', 'create', 'replace', 'remove', 'resume', 'reorder'] as const) {
      expect(rolesOf(handler)).not.toContain('packer');
    }
  });

  it('should raise not-found when reading a rule that is not a gift rule', async () => {
    const { controller } = build();
    await expect(controller.get(ID)).rejects.toBeInstanceOf(AutomationRuleNotFoundError);
  });

  it('should raise not-found when deleting a rule with another trigger', async () => {
    const { controller, rules } = build();
    rules.getRule.mockResolvedValue({ trigger: 'order.packed' } as never);

    await expect(controller.remove(ID)).rejects.toBeInstanceOf(AutomationRuleNotFoundError);
    expect(rules.deleteRule).not.toHaveBeenCalled();
  });

  it('should answer 404 when the dry run names an unknown order', async () => {
    const { controller, orders } = build();
    orders.getOrderRecord.mockResolvedValue(null);

    await expect(controller.evaluate({ orderId: 'nope' } as never)).rejects.toBeInstanceOf(NotFoundException);
  });
});
