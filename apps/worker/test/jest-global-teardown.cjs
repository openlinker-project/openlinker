/**
 * Jest Global Teardown (Worker Integration Tests)
 *
 * Jest globalTeardown must be a JS/CJS module. We bridge to the TS implementation
 * via ts-node for local/dev usage.
 */

require('ts-node/register/transpile-only');

module.exports = require('./integration/teardown').default;

