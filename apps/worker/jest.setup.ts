/**
 * Jest Setup for Worker Unit Tests
 *
 * Disables background worker loops to prevent memory leaks and test interference.
 * Unit tests should test components in isolation, not with running background processes.
 */

// Disable worker loops in unit tests to prevent memory leaks
process.env.WORKER_RUNNER_ENABLED = 'false';
process.env.WORKER_INTAKE_ENABLED = 'false';

// Reduce NestJS logging noise in unit tests
import { Logger } from '@nestjs/common';

// Only show warnings and errors in unit tests
Logger.overrideLogger(['warn', 'error']);


