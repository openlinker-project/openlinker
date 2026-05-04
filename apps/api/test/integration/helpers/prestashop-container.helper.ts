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
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
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
  // Bind-mount target for PS's `/var/www/html`. Required because PS's CLI
  // installer renames `/var/www/html/admin` to a randomized name (security
  // best-practice — see #506 / PS install code). On Docker's overlayfs,
  // renaming a directory inherited from the lower image layer to a new name
  // in the upper writable layer fails on some kernel/runtime combinations
  // (notably the self-hosted runner this CI lives on). A bind-mount onto a
  // real host directory uses the host filesystem's rename semantics and
  // works everywhere. The PS image's entrypoint detects the empty mount and
  // copies bundled PHP files into it before install runs.
  const psDataDir = mkdtempSync(join(tmpdir(), 'ol-ps-data-'));
  let mysql: StartedMySqlContainer | undefined;
  let prestashop: StartedTestContainer | undefined;

  // Live log buffers — populated from each container's stream via
  // `withLogConsumer`, which testcontainers attaches at builder time
  // (before the container even starts). The previous approach used
  // post-start `.logs()` and raced container death; this one can't.
  // 1MB cap each, FIFO eviction.
  const psLogBuffer = createLogBuffer();
  const mysqlLogBuffer = createLogBuffer();

  try {
    mysql = await startMysql(network, mysqlLogBuffer);
    prestashop = await startPrestashop(network, psLogBuffer, psDataDir);

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
      // Remove the bind-mount tmpdir last — PS containers running as root
      // sometimes leave files owned by the container's user; force-remove
      // ignores the resulting EPERM if any. Best-effort; a leaked /tmp dir
      // doesn't affect correctness.
      try {
        rmSync(psDataDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
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
    // debugger. The buffers are populated by testcontainers'
    // `withLogConsumer` (set up at builder time), so they survive
    // container death.
    dumpLogBuffer('prestashop', psLogBuffer);
    dumpLogBuffer('mysql', mysqlLogBuffer);

    // Belt-and-braces: also try `docker logs <id>` directly via child_process.
    // Survives the case where testcontainers' streaming consumer never got
    // any output (e.g. container died before a single chunk arrived). Docker
    // retains stopped-container logs by default, so this works post-mortem.
    if (prestashop) dockerLogsFallback('prestashop', prestashop);
    if (mysql) dockerLogsFallback('mysql', mysql);

    // Inspect state (exit code, OOM flag, etc.) — most legible via direct
    // `docker inspect`, again routed through child_process for reliability.
    if (prestashop) dockerInspectFallback('prestashop', prestashop);
    if (mysql) dockerInspectFallback('mysql', mysql);

    await Promise.allSettled([
      prestashop?.stop() ?? Promise.resolve(),
      mysql?.stop() ?? Promise.resolve(),
    ]);
    await network.stop().catch(() => {
      /* best-effort */
    });
    try {
      rmSync(psDataDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
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
 * Build a `withLogConsumer` callback that streams container output into
 * the supplied buffer. Hooked at builder time, so it can't race container
 * death the way a post-start `.logs()` call does.
 */
function makeLogConsumer(buf: LogBuffer): (stream: Readable) => void {
  return (stream: Readable) => {
    buf.attached = true;
    stream.on('data', (chunk: Buffer | string) => {
      appendToLogBuffer(buf, typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    });
    stream.on('error', (err) => {
      appendToLogBuffer(buf, `\n[log-stream error: ${formatError(err)}]\n`);
    });
  };
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
 * Belt-and-braces fallback: shell out to `docker logs <id>` directly.
 * Works even when testcontainers' streaming consumer received zero data
 * (e.g. container died before stdout flushed). Docker retains
 * stopped-container logs by default, so this is post-mortem-safe.
 */
function dockerLogsFallback(
  label: string,
  container: StartedTestContainer | StartedMySqlContainer,
): void {
  const tag = `[${label}-container fallback]`;
  let id: string;
  try {
    id = container.getId();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`${tag} could not resolve container id: ${formatError(err)}`);
    return;
  }
  try {
    const out = execFileSync('docker', ['logs', '--tail', '200', id], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    // eslint-disable-next-line no-console
    console.error(`${tag} docker logs --tail 200 ${id}:\n${out.toString('utf8')}`);
  } catch (err) {
    const stderr = err instanceof Error && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : '';
    // eslint-disable-next-line no-console
    console.error(`${tag} docker logs failed: ${formatError(err)}${stderr ? `\nstderr: ${stderr}` : ''}`);
  }
}

/**
 * Belt-and-braces: shell out to `docker inspect` for exit code + OOM flag.
 * Helps distinguish Apache crashed from OOM-killed from still-running.
 */
function dockerInspectFallback(
  label: string,
  container: StartedTestContainer | StartedMySqlContainer,
): void {
  const tag = `[${label}-container fallback]`;
  let id: string;
  try {
    id = container.getId();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`${tag} could not resolve container id: ${formatError(err)}`);
    return;
  }
  try {
    const out = execFileSync(
      'docker',
      [
        'inspect',
        '--format',
        '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} startedAt={{.State.StartedAt}} finishedAt={{.State.FinishedAt}}',
        id,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5_000,
      },
    );
    // eslint-disable-next-line no-console
    console.error(`${tag} docker inspect ${id}: ${out.toString('utf8').trim()}`);
  } catch (err) {
    const stderr = err instanceof Error && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : '';
    // eslint-disable-next-line no-console
    console.error(`${tag} docker inspect failed: ${formatError(err)}${stderr ? `\nstderr: ${stderr}` : ''}`);
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

async function startMysql(
  network: StartedNetwork,
  logBuffer: LogBuffer,
): Promise<StartedMySqlContainer> {
  return await new MySqlContainer(MYSQL_IMAGE)
    .withDatabase(MYSQL_DATABASE)
    .withUsername(MYSQL_USER)
    .withUserPassword(MYSQL_USER_PASSWORD)
    .withRootPassword(MYSQL_ROOT_PASSWORD)
    .withNetwork(network)
    .withNetworkAliases(MYSQL_NETWORK_ALIAS)
    .withLogConsumer(makeLogConsumer(logBuffer))
    // Cold-cache CI: MySQL 8.4 image is ~700MB, pull + boot can hit 3-4 min.
    // 240s gives enough headroom without masking real container failures.
    .withStartupTimeout(240_000)
    .start();
}

async function startPrestashop(
  network: StartedNetwork,
  logBuffer: LogBuffer,
  dataDir: string,
): Promise<StartedTestContainer> {
  return await new GenericContainer(PRESTASHOP_IMAGE)
    .withNetwork(network)
    .withExposedPorts(80)
    // Bind-mount a host tmpdir onto /var/www/html. The PS image's entrypoint
    // detects the empty mount and copies bundled PHP source into it before
    // install runs ("Reapplying PrestaShop files for enabled volumes" /
    // "Copying files from tmp directory" log lines). Required to make PS's
    // admin-folder rename succeed — see #506 / the install error
    // "The admin folder could not be renamed into admin..." that surfaced
    // on overlayfs without a bind-mount.
    .withBindMounts([{ source: dataDir, target: '/var/www/html', mode: 'rw' }])
    .withLogConsumer(makeLogConsumer(logBuffer))
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
