/**
 * Application Service
 *
 * Root application service providing basic application-level operations.
 * Currently provides a simple hello endpoint response.
 *
 * @module apps/api/src
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'OpenLinker API';
  }
}

