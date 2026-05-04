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
import { GenericContainer, Network, StartedNetwork, StartedTestContainer } from 'testcontainers';
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
  // Track started resources so we can tear them down on a partial-start
  // failure. `beforeAll` swallows post-throw teardown (Jest skips `afterAll`
  // when setup throws), so without this guard a failed PS boot would leak
  // the MySQL container + network until ryuk reaps them.
  const network = await new Network().start();
  let mysql: StartedMySqlContainer | undefined;
  let prestashop: StartedTestContainer | undefined;

  try {
    mysql = await startMysql(network);
    prestashop = await startPrestashop(network);

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

    // Confirm Apache is genuinely serving before handing the harness back to
    // the caller. PS's default entrypoint has been observed to exit on some
    // CI runners after install completes (likely via `apache2-foreground`
    // crash on a missing config / OOM kill / wrong PS_DOMAIN handling) — in
    // that case the MySQL `PS_VERSION_DB` poll succeeds but the next `fetch`
    // fails with the cryptic docker-modem "container not running" 409. A
    // probe here surfaces that failure with a much clearer message *and* a
    // log dump (see `verifyApacheUp` below) before tests start running.
    await verifyApacheUp(prestashop, baseUrl, seed.webserviceApiKey);

    // Hoist into stable locals so the cleanup closure doesn't rely on
    // mutable outer-scope bindings.
    const startedPrestashop = prestashop;
    const startedMysql = mysql;
    const startedNetwork = network;

    const cleanup = async (): Promise<void> => {
      // Stop in reverse start order. Use Promise.allSettled so a slow stop on
      // one container doesn't prevent the other from being torn down.
      await Promise.allSettled([startedPrestashop.stop(), startedMysql.stop()]);
      await startedNetwork.stop().catch(() => {
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
  } catch (err) {
    // Diagnostic capture — best-effort dump of container logs + state to
    // surface why setup failed in CI logs (where we can't `docker logs`
    // post-mortem). Done BEFORE stopping containers so tail-able state is
    // still readable.
    if (prestashop) {
      await dumpContainerState('prestashop', prestashop).catch(() => {
        /* best-effort */
      });
    }
    if (mysql) {
      await dumpContainerState('mysql', mysql).catch(() => {
        /* best-effort */
      });
    }
    await Promise.allSettled([
      prestashop?.stop() ?? Promise.resolve(),
      mysql?.stop() ?? Promise.resolve(),
    ]);
    await network.stop().catch(() => {
      /* best-effort */
    });
    throw err;
  }
}

/**
 * HTTP-probe Apache with retries until the WS responds or we time out.
 *
 * Hits `/api/carriers` (an authenticated WS endpoint) rather than the
 * storefront root — this confirms BOTH Apache is listening AND the
 * fixture-seeded WS API key is wired correctly. A failure here means
 * one of: Apache isn't running, the WS module isn't loaded, or the API
 * key fixture didn't take.
 *
 * On exhaustion, dumps PS container logs + exit state to stderr so the
 * CI log makes the failure mode legible without an interactive debugger.
 */
async function verifyApacheUp(
  prestashop: StartedTestContainer,
  baseUrl: string,
  apiKey: string,
): Promise<void> {
  const probeUrl = `${baseUrl.replace(/\/$/, '')}/api/carriers?display=full&output_format=JSON&limit=1`;
  const auth = Buffer.from(`${apiKey}:`).toString('base64');
  const deadline = Date.now() + 60_000; // 1 min — fixture is in place by now, this is just an Apache health check
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(probeUrl, {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}` },
      });
      if (response.ok) {
        // Drain body to free the underlying socket; we only care about the status.
        await response.text().catch(() => undefined);
        return;
      }
      lastError = new Error(`PS WS probe HTTP ${response.status}: ${response.statusText}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  await dumpContainerState('prestashop', prestashop).catch(() => undefined);
  throw new Error(
    `PrestaShop Apache did not respond to authenticated WS probe within 60s. ` +
      `Last error: ${formatError(lastError)}. ` +
      `Container logs were dumped above for diagnosis.`,
  );
}

/**
 * Best-effort container-log + state dump to stderr. Wraps stop-mode info
 * (exit code, OOM flag) and the tail of the container's stdout/stderr.
 *
 * Designed to fail silently — diagnostic capture must never bury the
 * original error. If the container is already gone or Docker's API is
 * unhappy, we just give up and let the caller throw the upstream error.
 */
async function dumpContainerState(
  label: string,
  container: StartedTestContainer | StartedMySqlContainer,
): Promise<void> {
  const tag = `[${label}-container]`;
  try {
    // testcontainers exposes `logs()` which returns a Readable stream.
    const stream = await container.logs();
    const lines: string[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer | string) => {
        lines.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      });
      stream.on('end', () => resolve());
      stream.on('err', reject);
      // Cap collection time — if the stream is hung, give up after 5s rather
      // than blocking the diagnostic dump.
      setTimeout(() => resolve(), 5_000);
    });
    const tail = lines.join('').split('\n').slice(-80).join('\n');
    // eslint-disable-next-line no-console
    console.error(`${tag} log tail (last 80 lines):\n${tail}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`${tag} log capture failed: ${formatError(err)}`);
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

async function startMysql(network: StartedNetwork): Promise<StartedMySqlContainer> {
  return await new MySqlContainer(MYSQL_IMAGE)
    .withDatabase(MYSQL_DATABASE)
    .withUsername(MYSQL_USER)
    .withUserPassword(MYSQL_USER_PASSWORD)
    .withRootPassword(MYSQL_ROOT_PASSWORD)
    .withNetwork(network)
    .withNetworkAliases(MYSQL_NETWORK_ALIAS)
    // Cold-cache CI: MySQL 8.4 image is ~700MB, pull + boot can hit 3-4 min.
    // 240s gives enough headroom without masking real container failures.
    .withStartupTimeout(240_000)
    .start();
}

async function startPrestashop(network: StartedNetwork): Promise<StartedTestContainer> {
  return await new GenericContainer(PRESTASHOP_IMAGE)
    .withNetwork(network)
    .withExposedPorts(80)
    .withEnvironment({
      // Env-var set mirrors the dev-stack `docker-compose.yml` PS service so
      // we exercise the same install path. Notable choices:
      // - `PS_COUNTRY=US` (uppercase) — the install CLI is case-sensitive on
      //   country codes; the dev-stack value is the proven one. Country choice
      //   is otherwise irrelevant to the smoke test (we don't depend on tax
      //   rules / currency defaults; PLN is added by the fixture).
      // - `PS_DOMAIN=localhost` (no port) — testcontainers picks a random host
      //   port at start time, so we can't bake the mapped port into the install.
      //   This is fine for WS calls (we hit the mapped port directly via baseUrl)
      //   but means storefront-redirect-based flows would misbehave; not an
      //   issue for the smoke spec or for Phase 2.
      PS_DOMAIN: 'localhost',
      PS_FOLDER_ADMIN: 'admin',
      PS_COUNTRY: 'US',
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
    // No HTTP wait strategy here. PS auto-install removes the installer URL
    // (`/install/index.php`) once it completes, so any fixed-URL HTTP probe
    // either succeeds too early (during install) or 404s post-install on
    // warm-cache reboots. The downstream `waitForPrestashopInstall` MySQL
    // poll is the actual install-completion signal — that's the source of
    // truth. `withStartupTimeout` covers the "did the container even boot"
    // check; PS_VERSION_DB covers "is the install finished".
    .withStartupTimeout(180_000)
    .start();
}
