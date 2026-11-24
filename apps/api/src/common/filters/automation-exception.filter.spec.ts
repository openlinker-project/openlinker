import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import {
  AutomationIllegalPairError,
  AutomationRuleNotFoundError,
} from '@openlinker/core/automation';
import { AutomationExceptionFilter } from './automation-exception.filter';

function createHost(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AutomationExceptionFilter', () => {
  const filter = new AutomationExceptionFilter();

  it('should send an explicit code and the pair as params, keeping the fields top-level (#3863)', () => {
    const { host, status, json } = createHost();

    filter.catch(new AutomationIllegalPairError('order.received', 'dispatch-shipment', 0), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AUTOMATION_TRIGGER_ACTION_ILLEGAL',
        params: { trigger: 'order.received', action: 'dispatch-shipment', index: 0 },
        error: 'AutomationIllegalPairError',
        trigger: 'order.received',
        action: 'dispatch-shipment',
      })
    );
  });

  it('should answer an unknown rule with 404 and its id', () => {
    const { host, status, json } = createHost();

    filter.catch(new AutomationRuleNotFoundError('rule-1'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'AUTOMATION_RULE_NOT_FOUND', params: { ruleId: 'rule-1' } })
    );
  });
});
