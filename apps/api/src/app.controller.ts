/**
 * Application Controller
 *
 * Root HTTP REST API controller providing basic application endpoints,
 * including health check and welcome message.
 *
 * @module apps/api/src
 */
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}

