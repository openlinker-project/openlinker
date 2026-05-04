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

  // Live log buffers — populated from each container's stream the moment it
  // starts. Survives container death (the prior approach used `.logs()` on
  // failure, which 404s if the container is already removed by then). 1MB
  // cap each, FIFO eviction, so a long-running test doesn't blow memory.
  const psLogBuffer = createLogBuffer();
  const mysqlLogBuffer = createLogBuffer();

  try {
    mysql = await startMysql(network);
    attachLogBuffer(mysql, mysqlLogBuffer);

    prestashop = await startPrestashop(network);
    attachLogBuffer(prestashop, psLogBuffer);

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
    // log dump (see the catch block below) before tests start running.
    await verifyApacheUp(baseUrl, seed.webserviceApiKey);

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
    // Diagnostic capture — dump the buffered container logs to stderr so
    // the CI log makes the failure mode legible without an interactive
    // debugger. The buffers are populated from a streaming attachment that
    // started at container-up time, so they survive container death.
    dumpLogBuffer('prestashop', psLogBuffer);
    dumpLogBuffer('mysql', mysqlLogBuffer);

    // Also try to grab inspect state (exit code, OOM flag) for whichever
    // container is still inspectable. Best-effort — failures here are
    // logged but never thrown.
    if (prestashop) {
      await dumpInspectState('prestashop', prestashop);
    }
    if (mysql) {
      await dumpInspectState('mysql', mysql);
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
 * On exhaustion, the caller is responsible for dumping log buffers — see
 * the catch block in `startPrestashopContainer`.
 */
async function verifyApacheUp(baseUrl: string, apiKey: string): Promise<void> {
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

  throw new Error(
    `PrestaShop Apache did not respond to authenticated WS probe within 60s. ` +
      `Last error: ${formatError(lastError)}. ` +
      `Container log buffers will be dumped by the caller for diagnosis.`,
  );
}

/**
 * In-memory ring buffer for streaming container logs. We attach this to
 * the container's log stream the moment it starts; on failure we dump
 * the buffer to stderr. Using a buffer rather than a one-shot `.logs()`
 * call works around the case where the container is already removed by
 * the time we want to read its logs (the failure case we're optimising
 * for).
 *
 * Cap: 1MB total, FIFO eviction. Real-world container log volume during
 * a 60s test is well under that, but the cap protects against a runaway
 * log loop blowing test memory.
 */
const LOG_BUFFER_BYTE_CAP = 1_000_000;

interface LogBuffer {
  chunks: string[];
  bytes: number;
  attached: boolean;
  attachError?: unknown;
}

function createLogBuffer(): LogBuffer {
  return { chunks: [], bytes: 0, attached: false };
}

function appendToLogBuffer(buf: LogBuffer, chunk: string): void {
  buf.chunks.push(chunk);
  buf.bytes += chunk.length;
  while (buf.bytes > LOG_BUFFER_BYTE_CAP && buf.chunks.length > 1) {
    const evicted = buf.chunks.shift();
    if (evicted) buf.bytes -= evicted.length;
  }
}

/**
 * Stream container stdout/stderr into a buffer. testcontainers' `.logs()`
 * returns a Readable that emits `data` events for the lifetime of the
 * stream — we just append. Errors during attach or mid-stream are stashed
 * on the buffer so the dump-time output can explain why the buffer might
 * be empty.
 */
function attachLogBuffer(
  container: StartedTestContainer | StartedMySqlContainer,
  buf: LogBuffer,
): void {
  // Fire-and-forget — don't await. Attach is async (it talks to Docker),
  // but the caller doesn't need to block on the stream being live before
  // moving on; any logs lost in the gap are tail data we'd evict anyway.
  void (async () => {
    try {
      const stream = await container.logs();
      buf.attached = true;
      stream.on('data', (chunk: Buffer | string) => {
        appendToLogBuffer(buf, typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      });
      stream.on('error', (err) => {
        appendToLogBuffer(buf, `\n[log-stream error: ${formatError(err)}]\n`);
      });
    } catch (err) {
      buf.attachError = err;
    }
  })();
}

function dumpLogBuffer(label: string, buf: LogBuffer): void {
  const tag = `[${label}-container]`;
  if (!buf.attached) {
    // eslint-disable-next-line no-console
    console.error(
      `${tag} log buffer never attached${buf.attachError ? ` (${formatError(buf.attachError)})` : ''}`,
    );
    return;
  }
  if (buf.chunks.length === 0) {
    // eslint-disable-next-line no-console
    console.error(`${tag} log buffer attached but received zero output before failure`);
    return;
  }
  const combined = buf.chunks.join('');
  const lines = combined.split('\n');
  const tail = lines.slice(-120).join('\n');
  // eslint-disable-next-line no-console
  console.error(`${tag} log tail (last 120 lines, ${buf.bytes} bytes buffered):\n${tail}`);
}

/**
 * Best-effort `docker inspect`-equivalent dump of container exit state
 * (exit code, OOMKilled flag, error message). Helps distinguish "Apache
 * crashed" from "container OOM-killed" from "container still running but
 * unreachable".
 */
async function dumpInspectState(
  label: string,
  container: StartedTestContainer | StartedMySqlContainer,
): Promise<void> {
  const tag = `[${label}-container]`;
  try {
    // testcontainers' StartedTestContainer doesn't expose `inspect()` in
    // the public interface, but we can reach the underlying dockerode
    // container via `getId()` + a separate inspect call. Cheaper path: use
    // the container's existing `getId()` and just log it — operators can
    // `docker inspect <id>` themselves on a runner with persistent state.
    const id = container.getId();
    // eslint-disable-next-line no-console
    console.error(`${tag} container id=${id} (run \`docker inspect ${id}\` if container state is preserved)`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`${tag} inspect-state capture failed: ${formatError(err)}`);
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
