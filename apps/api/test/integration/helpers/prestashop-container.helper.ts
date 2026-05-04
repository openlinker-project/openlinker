/**
 * PrestaShop Testcontainer Helper (#506)
 *
 * Boots a real PrestaShop instance (PS 9.0.x + MySQL 8.4) and seeds the
 * minimum DB state the carrier-mapping int-spec needs. Suite-scoped: meant
 * to be called from `beforeAll` of a single int-spec file. NOT wired into
 * the global Postgres+Redis harness because PS boot is heavy (~1GB image,
 * 60-90s with warm cache, 5-10 min cold-cache CI).
 *
 * Boot-time budget:
 *   - Warm Docker image cache (developer laptop, CI re-runs): ~60-90s
 *   - Cold cache (CI first run): 5-10 min (image pull + auto-install)
 *
 * Wait strategy: poll `ps_configuration.PS_VERSION_DB` until non-null. PS
 * writes that row only at the very end of auto-install, so it's the most
 * reliable completion signal. HTTP probes race the install (the storefront
 * answers before all configuration rows are written).
 *
 * @module apps/api/test/integration/helpers
 */
import { GenericContainer, Network, StartedNetwork, StartedTestContainer, Wait } from 'testcontainers';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import {
  applyPrestashopFixture,
  PrestashopFixtureSeed,
  waitForPrestashopInstall,
} from './prestashop-fixture.helper';

export interface PrestashopTestContainer {
  /** Storefront URL with port mapping resolved (no trailing slash). */
  baseUrl: string;
  /** WS API key seeded into ps_api_access. Use as the basic-auth username with empty password. */
  webserviceApiKey: string;
  /** id_carrier of the OpenLinker Dynamic stub carrier. */
  olDynamicCarrierId: number;
  /** id_currency of PLN. */
  plnCurrencyId: number;
  /** Stop both containers and tear down the network. */
  cleanup: () => Promise<void>;
}

const PRESTASHOP_IMAGE = 'prestashop/prestashop:9.0.2-2.0-classic-8.4';
const MYSQL_IMAGE = 'mysql:8.4';
const MYSQL_NETWORK_ALIAS = 'mysql';
const MYSQL_DATABASE = 'prestashop';
const MYSQL_USER = 'prestashop';
const MYSQL_USER_PASSWORD = 'prestashop';
const MYSQL_ROOT_PASSWORD = 'rootpassword';

/** Cold-cache CI worst case: ~10 min. We give the install a generous deadline so flakiness on slow runners is interpretable as install-stalled, not as test-framework noise. */
const INSTALL_DEADLINE_MS = 12 * 60_000;

/**
 * Start a PrestaShop test container with MySQL companion.
 *
 * Steps:
 *   1. Create an isolated Docker network so PS and MySQL can resolve each other by alias.
 *   2. Start MySQL 8.4 with a known root password.
 *   3. Start PrestaShop with `PS_INSTALL_AUTO=1` pointing at the MySQL companion.
 *   4. Wait for `ps_configuration.PS_VERSION_DB` to appear → install complete.
 *   5. Apply the fixture (WS API key, OL Dynamic carrier stub, PLN currency).
 *   6. Return container details + cleanup.
 */
export async function startPrestashopContainer(): Promise<PrestashopTestContainer> {
  const network = await new Network().start();

  const mysql = await startMysql(network);
  const prestashop = await startPrestashop(network);

  const mysqlOptions = {
    host: mysql.getHost(),
    port: mysql.getPort(),
    database: MYSQL_DATABASE,
    user: MYSQL_USER,
    password: MYSQL_USER_PASSWORD,
  };

  await waitForPrestashopInstall(mysqlOptions, INSTALL_DEADLINE_MS);

  const seed: PrestashopFixtureSeed = await applyPrestashopFixture(mysqlOptions);

  const baseUrl = `http://${prestashop.getHost()}:${prestashop.getMappedPort(80)}`;

  const cleanup = async (): Promise<void> => {
    // Stop in reverse start order. Use Promise.allSettled so a slow stop on
    // one container doesn't prevent the other from being torn down.
    await Promise.allSettled([prestashop.stop(), mysql.stop()]);
    await network.stop().catch(() => {
      // Network teardown is best-effort — if Docker has already pruned it,
      // nothing else this test owns is affected.
    });
  };

  return {
    baseUrl,
    webserviceApiKey: seed.webserviceApiKey,
    olDynamicCarrierId: seed.olDynamicCarrierId,
    plnCurrencyId: seed.plnCurrencyId,
    cleanup,
  };
}

async function startMysql(network: StartedNetwork): Promise<StartedMySqlContainer> {
  return await new MySqlContainer(MYSQL_IMAGE)
    .withDatabase(MYSQL_DATABASE)
    .withUsername(MYSQL_USER)
    .withUserPassword(MYSQL_USER_PASSWORD)
    .withRootPassword(MYSQL_ROOT_PASSWORD)
    .withNetwork(network)
    .withNetworkAliases(MYSQL_NETWORK_ALIAS)
    .withStartupTimeout(120_000)
    .start();
}

async function startPrestashop(network: StartedNetwork): Promise<StartedTestContainer> {
  return await new GenericContainer(PRESTASHOP_IMAGE)
    .withNetwork(network)
    .withExposedPorts(80)
    .withEnvironment({
      PS_DOMAIN: 'localhost',
      PS_FOLDER_ADMIN: 'admin',
      PS_COUNTRY: 'pl',
      PS_LANGUAGE: 'en',
      PS_DB_SERVER: MYSQL_NETWORK_ALIAS,
      PS_DB_NAME: MYSQL_DATABASE,
      PS_DB_USER: MYSQL_USER,
      PS_DB_PASSWD: MYSQL_USER_PASSWORD,
      PS_DB_PREFIX: 'ps_',
      PS_ENABLE_SSL: '0',
      PS_DEMO_MODE: '0',
      PS_DEV_MODE: '0',
      PS_INSTALL_AUTO: '1',
      DB_SERVER: MYSQL_NETWORK_ALIAS,
      DB_NAME: MYSQL_DATABASE,
      DB_USER: MYSQL_USER,
      DB_PASSWD: MYSQL_USER_PASSWORD,
      DB_PREFIX: 'ps_',
      ADMIN_MAIL: 'demo@prestashop.com',
      ADMIN_PASSWD: 'prestashop_demo',
    })
    // HTTP probe Apache is up; we use the MySQL `PS_VERSION_DB` poll as the
    // *install* completion signal (storefront answers before configuration
    // is fully written).
    .withWaitStrategy(Wait.forHttp('/install/index.php', 80).withStartupTimeout(180_000))
    .withStartupTimeout(180_000)
    .start();
}
