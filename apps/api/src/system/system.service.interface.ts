/**
 * System Service Interface
 *
 * Contract for the system service that surfaces server-side runtime
 * configuration to the frontend via GET /system/config.
 *
 * @module apps/api/src/system
 */
import type { SystemConfigDto } from './dto/system-config.dto';

export interface ISystemService {
  getConfig(): SystemConfigDto;
}

export const SYSTEM_SERVICE_TOKEN = Symbol('ISystemService');
