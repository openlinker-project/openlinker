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
import { randomBytes } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { createConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Readable } from 'stream';
import { GenericContainer, Network, StartedNetwork, StartedTestContainer } from 'testcontainers';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import {
  applyPrestashopFixture,
  ApplyFixtureOptions,
  configurePrestashopAccessUrl,
  PrestashopFixtureSeed,
  waitForPrestashopInstall,
} from './prestashop-fixture.helper';

export interface PrestashopTestContainer {
  /** Storefront URL with port mapping resolved (no trailing slash). */
  baseUrl: string;
  /** WS API key seeded into ps_api_access. Use as the basic-auth username with empty password. */
  webserviceApiKey: string;
  /**
   * id_carrier of the OpenLinker Dynamic carrier.
   *
   * When the harness was started with `installOlModule: true` this is the
   * live module-installed carrier row: its `cartshipping.php` front-controller
   * endpoint is wired and HMAC-verified, so adapter-side `writeCartShipping`
   * calls produce real sidecar rows that `Carrier::getOrderShippingCostExternal`
   * reads at order-create time. Coincides with
   * `ps_configuration.OPENLINKER_DYNAMIC_CARRIER_ID`.
   *
   * When `installOlModule` is false (default) this is the SQL-stub row seeded
   * by `seedOlDynamicCarrier` — sufficient for `discoverDynamicCarrierId()`
   * to find a row, but the runtime `cartshipping.php` controller is not
   * installed, so the HMAC round-trip is not exercised. Specs that need the
   * round-trip MUST opt in via `installOlModule: true`.
   */
  olDynamicCarrierId: number;
  /** id_currency of PLN. */
  plnCurrencyId: number;
  /**
   * HMAC shared secret (random per run, 64 hex chars).
   *
   * Only meaningful when the harness was started with `installOlModule: true`,
   * in which case the same bytes are seeded into
   * `ps_configuration.OPENLINKER_WEBHOOK_SECRET` (module-receiver side) AND
   * returned here so the int-spec can wire the adapter side via the
   * `WebhookSecretProviderPort` env-var fallback.
   *
   * When `installOlModule` is false the secret is generated but unused; it's
   * always populated to keep the harness shape stable across configurations.
   */
  webhookSharedSecret: string;
  /**
   * MySQL companion connection details — exposed so vertical-slice specs
   * (e.g. carrier-mapping #535) can seed additional rows the WS doesn't
   * cover ergonomically (products, identifier-mapping bootstrap, default
   * carrier lookup by name). Direct DB access for tests is consistent with
   * how the WS API key + OL Dynamic carrier are seeded by this helper.
   */
  mysqlAddress: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  /** Stop both containers and tear down the network. */
  cleanup: () => Promise<void>;
}

/**
 * Pinned PS image tag — exported so diagnostic helpers in spec files can match
 * on the same tag via `docker ps --filter ancestor=...` without duplicating the
 * literal. Kept aligned with the dev-stack docker-compose pin (see `docs/testing-guide.md`).
 */
export const PRESTASHOP_IMAGE = 'prestashop/prestashop:9.0.2-2.0-classic-8.4';
const MYSQL_IMAGE = 'mysql:8.4';
const MYSQL_NETWORK_ALIAS = 'mysql';
const MYSQL_DATABASE = 'prestashop';
const MYSQL_USER = 'prestashop';
const MYSQL_USER_PASSWORD = 'prestashop';
const MYSQL_ROOT_PASSWORD = 'rootpassword';

/** Cold-cache CI worst case: ~10 min. We give the install a generous deadline so flakiness on slow runners is interpretable as install-stalled, not as test-framework noise. */
const INSTALL_DEADLINE_MS = 12 * 60_000;

/**
 * Path to the OpenLinker PrestaShop module source on the host, resolved
 * relative to this helper's location. Hoisted to a named constant because
 * the `../../../../` depth count is brittle if this helper ever moves —
 * grep for `MODULE_SOURCE_PATH` to find the resolution target instead of
 * recounting `..`s in a call site. Target: `apps/prestashop-module/openlinker`.
 */
const MODULE_SOURCE_PATH = resolve(__dirname, '../../../../prestashop-module/openlinker');

/**
 * Default per-`bin/console` exec timeout. PS module install + uninstall
 * cycles complete in ~2-5s on warm-cache locally; 120s gives generous
 * headroom for slow CI runners while still failing actionably if the
 * underlying PHP hangs (lock contention, fatal error, OOM). Without this,
 * a hung exec would silently consume the 15-minute `beforeAll` deadline.
 */
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;

/**
 * Options for {@link startPrestashopContainer}. Today only carries the
 * OL-module opt-in flag; new knobs land here without a signature break.
 */
export interface StartPrestashopContainerOptions {
  /**
   * When true, install the real OpenLinker PrestaShop module into the
   * container between `waitForPrestashopInstall` and `applyPrestashopFixture`.
   * Required for specs that exercise the OL Dynamic carrier round-trip (#692).
   *
   * Default `false` — keeps boot fast for specs that don't need it AND avoids
   * a known CI-environment failure mode where the install transition leaves
   * the PS WS returning HTTP 500 on the subsequent `verifyApacheUp` probe
   * (works locally on macOS Docker-Desktop, fails on the self-hosted Linux
   * runner — root cause TBD). Specs that opt in should expect this risk and
   * handle CI flakes accordingly.
   */
  installOlModule?: boolean;
}

/**
 * Start a PrestaShop test container with MySQL companion.
 *
 * Steps:
 *   1. Create an isolated Docker network so PS and MySQL can resolve each other by alias.
 *   2. Start MySQL 8.4 with a known root password.
 *   3. Start PrestaShop with `PS_INSTALL_AUTO=1` pointing at the MySQL companion.
 *   4. Wait for `ps_configuration.PS_VERSION_DB` to appear → install complete.
 *   5. (Optional, when `options.installOlModule` is true) Install the real OL
 *      PrestaShop module — see {@link installOpenLinkerModuleIntoContainer}.
 *   6. Apply the fixture (WS API key, OL Dynamic carrier stub OR module-installed
 *      row, PLN currency).
 *   7. Return container details + cleanup.
 */
export async function startPrestashopContainer(
  options: StartPrestashopContainerOptions = {},
): Promise<PrestashopTestContainer> {
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

    // Always generate the per-run secret so the returned harness has a stable
    // shape. When `options.installOlModule` is false the bytes are unused —
    // a small waste of entropy in exchange for not making `webhookSharedSecret`
    // nullable downstream.
    const webhookSharedSecret = randomBytes(32).toString('hex');
    if (options.installOlModule) {
      // Install the OL PS module BEFORE applyPrestashopFixture. The fixture's
      // `seedOlDynamicCarrier` early-returns when it finds a carrier row with
      // `external_module_name='openlinker'` — which the module install creates
      // first — so this ordering avoids the stub-vs-real conflict that would
      // arise from running the fixture first. Inside the same try/catch so a
      // module-install failure still triggers the container teardown path
      // below (logs dump + `Promise.allSettled(stop)` + network removal).
      await installOpenLinkerModuleIntoContainer({
        prestashop,
        mysqlAddress: mysqlOptions,
        sharedSecret: webhookSharedSecret,
        modulePath: MODULE_SOURCE_PATH,
      });
    }

    const seed: PrestashopFixtureSeed = await applyPrestashopFixture(mysqlOptions);

    const externalHost = prestashop.getHost();
    const externalPort = prestashop.getMappedPort(80);
    const externalHostPort = `${externalHost}:${externalPort}`;
    const baseUrl = `http://${externalHostPort}`;

    // Tell PS its canonical URL is the test-container's mapped host:port
    // (not the install-time "localhost" without a port). Without this,
    // every WS request 302s to the canonical URL via Tools::redirectCanonical,
    // which the test runner can't follow back into the container.
    await configurePrestashopAccessUrl(mysqlOptions, externalHostPort);

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
      webhookSharedSecret,
      mysqlAddress: mysqlOptions,
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

    // PS app-internal logs: Apache error_log, Symfony app log, PS legacy
    // log, plus a directory listing of /modules/openlinker to verify the
    // module copy landed. These live inside the container filesystem and
    // are invisible to `docker logs` — execing into the still-running
    // container is the only way to surface them in a CI run.
    //
    // Best-effort: if the container has already exited, `exec` will fail
    // and the helper swallows the error. The dumpInspect output above
    // tells us whether that's the case.
    if (prestashop) await dumpPrestashopAppLogs(prestashop);

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
  let lastRedirectLocation: string | null = null;

  // Capture the body of the most recent error response. PS Symfony renders
  // its exception page (or the JSON `errors` array from the WS layer) inline
  // in the response body — this is usually the single most useful piece of
  // root-cause data on a 500 and is otherwise invisible to the caller.
  let lastErrorBody: string | null = null;

  while (Date.now() < deadline) {
    try {
      // Don't follow redirects automatically. PS will 302 to its configured
      // canonical domain (PS_DOMAIN = "localhost" with no port) when SSL or
      // canonical-URL logic kicks in, and a follow into "localhost:80" fails
      // from outside the container with an opaque "fetch failed". Capturing
      // the Location explicitly gives us actionable info.
      const response = await fetch(probeUrl, {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}` },
        redirect: 'manual',
      });
      if (response.ok) {
        await response.text().catch(() => undefined);
        return;
      }
      if (response.status >= 300 && response.status < 400) {
        lastRedirectLocation = response.headers.get('location');
        lastError = new Error(
          `PS WS probe HTTP ${response.status} → Location: ${lastRedirectLocation ?? '<none>'}`,
        );
      } else {
        // Slurp body for 4xx/5xx. Cap to 8KB — a Symfony stack trace fits
        // comfortably; anything larger is almost certainly an HTML error
        // page that won't help.
        lastErrorBody = await response
          .text()
          .then((body) => (body.length > 8192 ? `${body.slice(0, 8192)}…[truncated]` : body))
          .catch(() => null);
        lastError = new Error(`PS WS probe HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (lastErrorBody) {
    // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
    console.error(
      `[prestashop-container] last failed probe response body (${lastErrorBody.length} bytes):\n${lastErrorBody}`,
    );
  }

  throw new Error(
    `PrestaShop Apache did not respond OK to authenticated WS probe within 60s. ` +
      `Last error: ${formatError(lastError)}` +
      (lastRedirectLocation ? ` (redirect target: ${lastRedirectLocation})` : '') +
      `. Container log buffers will be dumped by the caller for diagnosis.`,
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
    // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
    console.error(
      `${tag} log buffer never attached${buf.attachError ? ` (${formatError(buf.attachError)})` : ''}`,
    );
    return;
  }
  if (buf.chunks.length === 0) {
    // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
    console.error(`${tag} log buffer attached but received zero output before failure`);
    return;
  }
  const combined = buf.chunks.join('');
  const lines = combined.split('\n');
  const tail = lines.slice(-120).join('\n');
  // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
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
    // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
    console.error(`${tag} could not resolve container id: ${formatError(err)}`);
    return;
  }
  try {
    const out = execFileSync('docker', ['logs', '--tail', '200', id], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
    console.error(`${tag} docker logs --tail 200 ${id}:\n${out.toString('utf8')}`);
  } catch (err) {
    const stderr = err instanceof Error && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : '';
    // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
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
    // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
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
    // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
    console.error(`${tag} docker inspect ${id}: ${out.toString('utf8').trim()}`);
  } catch (err) {
    const stderr = err instanceof Error && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : '';
    // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
    console.error(`${tag} docker inspect failed: ${formatError(err)}${stderr ? `\nstderr: ${stderr}` : ''}`);
  }
}

/**
 * Exec into the still-running PS container and dump the application logs
 * that aren't visible to `docker logs`:
 *   - Apache `error.log` / `access.log` (php errors + request log)
 *   - Symfony app log (`/var/www/html/var/logs/*.log`) — stack traces
 *   - PS legacy log (`/var/www/html/cache/log/*.log`) — older code paths
 *   - Directory listing of `/var/www/html/modules/openlinker` — verifies
 *     the module copy + ownership chown actually landed
 *
 * The single `sh -c` payload is intentional: one exec call, all relevant
 * sources, fully best-effort (`|| true` guards) so a missing file never
 * masks an existing one. Output is funneled through `console.error` so
 * the GitHub Actions log captures it.
 *
 * No-op (but logs why) if the container has already exited — the inspect
 * dump above will say whether that's the case.
 */
async function dumpPrestashopAppLogs(prestashop: StartedTestContainer): Promise<void> {
  const tag = '[prestashop-container app-logs]';
  const script = [
    'echo "--- /var/log/apache2/error.log (tail 200) ---"',
    'tail -n 200 /var/log/apache2/error.log 2>/dev/null || echo "(no apache error.log)"',
    'echo "--- /var/log/apache2/access.log (tail 100) ---"',
    'tail -n 100 /var/log/apache2/access.log 2>/dev/null || echo "(no apache access.log)"',
    'echo "--- /var/www/html/var/logs (Symfony app logs) ---"',
    'ls -la /var/www/html/var/logs/ 2>/dev/null || echo "(no /var/www/html/var/logs)"',
    'for f in /var/www/html/var/logs/*.log; do [ -f "$f" ] && { echo "--- $f (tail 200) ---"; tail -n 200 "$f"; }; done 2>/dev/null',
    'echo "--- /var/www/html/cache/log (PS legacy logs) ---"',
    'ls -la /var/www/html/cache/log/ 2>/dev/null || echo "(no /var/www/html/cache/log)"',
    'for f in /var/www/html/cache/log/*.log; do [ -f "$f" ] && { echo "--- $f (tail 200) ---"; tail -n 200 "$f"; }; done 2>/dev/null',
    'echo "--- /var/www/html/modules/openlinker (module install state) ---"',
    'ls -la /var/www/html/modules/openlinker/ 2>/dev/null || echo "(no /var/www/html/modules/openlinker)"',
    'echo "--- php -v ---"',
    'php -v 2>&1 || true',
  ].join('; ');
  try {
    const result = await prestashop.exec(['sh', '-c', script]);
    // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
    console.error(
      `${tag} exit=${result.exitCode}\nstdout:\n${result.stdout}` +
        (result.stderr ? `\nstderr:\n${result.stderr}` : ''),
    );
  } catch (err) {
    // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
    console.error(
      `${tag} exec failed (container may have already exited): ${formatError(err)}`,
    );
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

/**
 * Options for {@link installOpenLinkerModuleIntoContainer}. Named-object shape
 * because a four-arg positional call would force every future option (timeout
 * override, alternate module name, ...) into a positional slot that's hard to
 * grep at call sites.
 */
interface InstallOpenLinkerModuleOptions {
  /** Started PrestaShop container — must have completed auto-install. */
  prestashop: StartedTestContainer;
  /** MySQL connection details for the same shop. */
  mysqlAddress: ApplyFixtureOptions;
  /**
   * HMAC shared secret to seed into `ps_configuration.OPENLINKER_WEBHOOK_SECRET`.
   * Caller is responsible for wiring the same bytes into the adapter side
   * (e.g. via `process.env.OPENLINKER_WEBHOOK_SECRET__PRESTASHOP`).
   */
  sharedSecret: string;
  /** Absolute path on the host to `apps/prestashop-module/openlinker`. */
  modulePath: string;
}

/**
 * Install the real OpenLinker PrestaShop module into a running PS Testcontainer.
 *
 * Flow:
 *   1. Copy the module directory from the worktree into the container's
 *      `/var/www/html/modules/openlinker`. Post-start `copyDirectoriesToContainer`
 *      rather than builder-time `withCopyDirectoriesToContainer` — the bind-mount
 *      on `/var/www/html` (populated by PS's entrypoint after start) would mask
 *      a builder-time copy.
 *   2. `chown -R www-data:www-data` so PS's `installDynamicCarrier()` can write
 *      the carrier logo into `_PS_SHIP_IMG_DIR_` (fail-fast on copy error per
 *      the LP Express pattern in `openlinker.php:818`).
 *   3. `php bin/console prestashop:module install openlinker`, then `uninstall`
 *      + `install` cycle. Per `docs/operations/prestashop-module-rename-migration.md:127-131`
 *      PS 9.0.2's Symfony module-installer occasionally bypasses the legacy
 *      `install()` hook on first invocation; the cycle forces it. Cost ~2-5s.
 *   4. SQL-upsert `OPENLINKER_WEBHOOK_SECRET` into `ps_configuration` — the
 *      module's `setDefaultConfiguration()` resets it to empty string during
 *      install, so this MUST happen after step 3.
 *   5. Pre-flight: SELECT the secret back, assert it equals the seeded value.
 *      Catches a future PS-version regression in `Configuration::updateValue()`
 *      semantics with a precise diagnostic instead of a 401 from `cartshipping.php`.
 *
 * Throws with captured stdout/stderr on any non-zero exec exit, so the failure
 * mode reaches the CI log without an interactive debugger.
 */
async function installOpenLinkerModuleIntoContainer(
  options: InstallOpenLinkerModuleOptions,
): Promise<void> {
  const { prestashop, mysqlAddress, sharedSecret, modulePath } = options;

  // 1. Materialise the module source inside the container.
  await prestashop.copyDirectoriesToContainer([
    { source: modulePath, target: '/var/www/html/modules/openlinker' },
  ]);

  // 2. Apache (www-data) needs RW on the module dir for the install-time
  //    logo copy (`@copy(.../carrier.jpg, _PS_SHIP_IMG_DIR_)`). Files arrive
  //    owned by root via the docker-cp shape testcontainers uses.
  await runExecOrThrow(prestashop, ['chown', '-R', 'www-data:www-data', '/var/www/html/modules/openlinker']);

  // 3. Install cycle. First `install` registers the module; the
  //    `uninstall + install` follow-up forces the legacy `install()` hook
  //    to run (PS 9.0.2 Symfony installer flake — see docblock).
  await runExecOrThrow(prestashop, ['php', 'bin/console', 'prestashop:module', 'install', 'openlinker'], { workingDir: '/var/www/html' });
  await runExecOrThrow(prestashop, ['php', 'bin/console', 'prestashop:module', 'uninstall', 'openlinker'], { workingDir: '/var/www/html' });
  await runExecOrThrow(prestashop, ['php', 'bin/console', 'prestashop:module', 'install', 'openlinker'], { workingDir: '/var/www/html' });

  // 4. Seed the HMAC secret. setDefaultConfiguration() set it to '' on install.
  const conn = await createConnection({
    host: mysqlAddress.host,
    port: mysqlAddress.port,
    user: mysqlAddress.user,
    password: mysqlAddress.password,
    database: mysqlAddress.database,
    multipleStatements: false,
  });
  try {
    // PS's `setDefaultConfiguration()` already created the row via
    // `Configuration::updateValue('OPENLINKER_WEBHOOK_SECRET', '')` during
    // install — populated with `(id_shop, id_shop_group)` matching the PS
    // single-shop default. We UPDATE in place keyed on `name` alone (all
    // shop-binding variants get the same secret). A bare INSERT...ON DUPLICATE
    // KEY UPDATE with NULL shop bindings would create a sibling row that the
    // module's `Configuration::get` ignores, and the pre-flight assertion
    // below would still see the empty original.
    const [updateResult] = await conn.execute<ResultSetHeader>(
      `UPDATE ps_configuration SET value = ?, date_upd = NOW() WHERE name = 'OPENLINKER_WEBHOOK_SECRET'`,
      [sharedSecret],
    );
    if (updateResult.affectedRows === 0) {
      throw new Error(
        `OL module install: no OPENLINKER_WEBHOOK_SECRET row in ps_configuration after install. ` +
          `Expected setDefaultConfiguration() to have created it. Check the install-cycle output above.`,
      );
    }

    // 5. Pre-flight: verify the seed actually landed. Cheap belt-and-braces.
    const [secretRows] = await conn.execute<(RowDataPacket & { value: string })[]>(
      `SELECT value FROM ps_configuration WHERE name = 'OPENLINKER_WEBHOOK_SECRET' LIMIT 1`,
    );
    if (secretRows.length === 0 || secretRows[0].value !== sharedSecret) {
      throw new Error(
        `OL module install: OPENLINKER_WEBHOOK_SECRET seed verification failed. ` +
          `Expected ${sharedSecret.length}-char secret, got ${secretRows[0]?.value?.length ?? 0} chars. ` +
          `Configuration::updateValue() semantics may have drifted in this PS version.`,
      );
    }

    // Verify the carrier + sidecar table the module's install hook should have
    // produced. If either is missing, the install-cycle hack didn't take and
    // S-3 would 401 / 500 cryptically downstream.
    const [carrierRows] = await conn.execute<(RowDataPacket & { id_carrier: number })[]>(
      `SELECT id_carrier FROM ps_carrier WHERE external_module_name = 'openlinker' AND active = 1 AND deleted = 0 LIMIT 1`,
    );
    if (carrierRows.length === 0) {
      throw new Error(
        `OL module install: no ps_carrier row with external_module_name='openlinker' after install. ` +
          `The legacy install() hook didn't run — Symfony installer flake (see docblock); ` +
          `try increasing the uninstall+install cycle to two iterations.`,
      );
    }
    const [tableRows] = await conn.execute<(RowDataPacket & { TABLE_NAME: string })[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ps_openlinker_cart_shipping' LIMIT 1`,
    );
    if (tableRows.length === 0) {
      throw new Error(
        `OL module install: ps_openlinker_cart_shipping table missing after install. ` +
          `Same root cause as the carrier-row check above — the legacy install() hook did not run.`,
      );
    }
  } finally {
    await conn.end();
  }
}

/**
 * `prestashop.exec`-with-throw helper. Captures stdout/stderr so a non-zero
 * exit code surfaces an actionable diagnostic to the CI log instead of a bare
 * "module install failed" message.
 *
 * Wraps `prestashop.exec` in a `Promise.race` against a timeout deadline —
 * testcontainers' exec API doesn't expose cancellation, so the underlying
 * exec may keep running inside the container after a timeout, but we stop
 * blocking the test and fail with an actionable message. Without this,
 * a hung exec would silently consume the suite's `beforeAll` deadline.
 * Default 120s per call; override via `opts.timeoutMs` for commands that
 * legitimately take longer.
 */
async function runExecOrThrow(
  prestashop: StartedTestContainer,
  command: string[],
  opts?: { workingDir?: string; timeoutMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(
          `Command timed out after ${timeoutMs}ms in PS container: ${command.join(' ')}\n` +
            `Underlying exec may still be running inside the container; check docker logs ` +
            `for the PS PHP error log if this is a hang on install.`,
        ),
      );
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([
      prestashop.exec(command, opts ? { workingDir: opts.workingDir } : undefined),
      timeoutPromise,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        `Command failed in PS container (exit=${result.exitCode}): ${command.join(' ')}\n` +
          `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    // In CI, dump the success-path output too. The install/uninstall/install
    // cycle "succeeds" (exit=0) but can still leave PS in a broken state —
    // a deprecation notice in stderr, a Symfony cache-clear warning, a
    // missing-class autoload error after install. Without this dump those
    // signals never reach the CI log. Local dev defaults to quiet to keep
    // the test output legible.
    if (process.env.CI === 'true') {
      // eslint-disable-next-line no-console -- CLI / one-shot script: stdout is the user-facing channel
      console.error(
        `[prestashop-container exec] ${command.join(' ')} → exit=0\nstdout:\n${result.stdout}` +
          (result.stderr ? `\nstderr:\n${result.stderr}` : ''),
      );
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
