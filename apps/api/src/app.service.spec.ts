/**
 * Application Service Unit Tests
 *
 * Unit tests for AppService, verifying basic service functionality
 * and return values.
 *
 * @module apps/api/src
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AppService],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return "OpenLinker API"', () => {
    expect(service.getHello()).toBe('OpenLinker API');
  });
});
