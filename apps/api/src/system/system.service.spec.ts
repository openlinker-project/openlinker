import type { IDemoModeService } from '../auth/demo-mode.service.interface';
import { SystemService } from './system.service';

describe('SystemService', () => {
  function makeService(demoMode: boolean): SystemService {
    const demoModeService: IDemoModeService = {
      isDemoModeEnabled: () => demoMode,
    };
    return new SystemService(demoModeService);
  }

  it('should return demoMode: true when demo mode is enabled', () => {
    expect(makeService(true).getConfig()).toEqual({ demoMode: true });
  });

  it('should return demoMode: false when demo mode is disabled', () => {
    expect(makeService(false).getConfig()).toEqual({ demoMode: false });
  });
});
