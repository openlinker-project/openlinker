import { Test, type TestingModule } from '@nestjs/testing';
import { SystemController } from './system.controller';
import { SYSTEM_SERVICE_TOKEN, type ISystemService } from './system.service.interface';

describe('SystemController', () => {
  let controller: SystemController;
  let systemService: jest.Mocked<ISystemService>;

  beforeEach(async () => {
    const mockService: jest.Mocked<ISystemService> = {
      getConfig: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemController],
      providers: [{ provide: SYSTEM_SERVICE_TOKEN, useValue: mockService }],
    }).compile();

    controller = module.get(SystemController);
    systemService = module.get(SYSTEM_SERVICE_TOKEN);
  });

  it('should return the system config', () => {
    systemService.getConfig.mockReturnValue({ demoMode: true });
    expect(controller.getConfig()).toEqual({ demoMode: true });
  });

  it('should return demoMode: false when demo mode is off', () => {
    systemService.getConfig.mockReturnValue({ demoMode: false });
    expect(controller.getConfig()).toEqual({ demoMode: false });
  });
});
