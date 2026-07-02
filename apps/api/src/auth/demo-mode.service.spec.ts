import { ConfigService } from '@nestjs/config';
import { DemoModeService } from './demo-mode.service';

describe('DemoModeService', () => {
  function makeService(value: string): DemoModeService {
    const configService = { get: jest.fn().mockReturnValue(value) } as unknown as ConfigService;
    return new DemoModeService(configService);
  }

  it('should return true when OL_DEMO_MODE is "true"', () => {
    expect(makeService('true').isDemoModeEnabled()).toBe(true);
  });

  it('should return true when OL_DEMO_MODE is "TRUE" (case-insensitive)', () => {
    expect(makeService('TRUE').isDemoModeEnabled()).toBe(true);
  });

  it('should return true when OL_DEMO_MODE has surrounding whitespace', () => {
    expect(makeService('  true  ').isDemoModeEnabled()).toBe(true);
  });

  it('should return false when OL_DEMO_MODE is "false"', () => {
    expect(makeService('false').isDemoModeEnabled()).toBe(false);
  });

  it('should return false when OL_DEMO_MODE is not set (default "false")', () => {
    const configService = {
      get: jest.fn().mockReturnValue('false'),
    } as unknown as ConfigService;
    const service = new DemoModeService(configService);
    expect(service.isDemoModeEnabled()).toBe(false);
  });
});
