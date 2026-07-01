/**
 * @openlinker/test-kit — Public Barrel
 *
 * Integration-test harness for OpenLinker host apps and plugin authors.
 * Exposes Testcontainer lifecycle helpers + a NestJS-bootstrap factory.
 * See `docs/plugin-author-guide.md` § "Testing your adapter" for usage.
 *
 * @module libs/test-kit
 */
export { CI_RUN_ID_LABEL, ciRunIdLabels, startContainers, stopContainers } from './containers';
export { createIntegrationTestHarness } from './harness';
export type {
  ContainerConfig,
  ContainerHandles,
  IntegrationTestHarness,
  IntegrationTestHarnessConfig,
  TestHarnessHandle,
} from './types';
