/**
 * Jest Global Setup (Worker Integration Tests)
 *
 * Jest globalSetup must be a JS/CJS module. We bridge to the TS implementation
 * via ts-node for local/dev usage.
 */

require('ts-node/register/transpile-only');

// Disable background loops during integration tests (we manually call handlers).
process.env.WORKER_RUNNER_ENABLED = 'false';
process.env.WORKER_INTAKE_ENABLED = 'false';

module.exports = require('./integration/setup-global').default;

