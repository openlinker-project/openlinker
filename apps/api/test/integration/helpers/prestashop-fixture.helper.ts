/**
 * PrestaShop Testcontainer Fixture Helper (#506)
 *
 * Seeds the minimum PrestaShop database state the carrier-mapping int-spec
 * needs after PS auto-install completes:
 *
 *   1. A WS API key (random per run) + permissions on the resources the
 *      adapter touches.
 *   2. A stub OpenLinker Dynamic carrier row keyed by
 *      `external_module_name='openlinker'`. Stub-only — sufficient for
 *      `discoverDynamicCarrierId()` to find it, but the OL PHP module's
 *      runtime endpoints (e.g. `cartshipping`) are NOT installed, so the
 *      runtime OL Dynamic path is not exercised by the v1 spec. **Source
 *      of truth for the real carrier install** lives in
 *      `apps/prestashop-module/openlinker/openlinker.php` (`installCarrier`
 *      method); when that drifts, this stub goes stale and must be updated.
 *   3. The `PLN` currency activated (PS_COUNTRY=US/EN install seeds USD/EUR
 *      only by default; the int-spec uses PLN to mirror an Allegro-PL order).
 *
 * Pure SQL via the `mysql2` driver against the Testcontainer MySQL companion.
 * Idempotent: re-running the fixture against the same container is safe.
 *
 * @module apps/api/test/integration/helpers
 */
import { randomBytes } from 'crypto';
import {
  createConnection,
  Connection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';

export interface PrestashopFixtureSeed {
  /** Generated WS API key — pass this to the connection's credentials store. */
  webserviceApiKey: string;
  /** id_carrier of the seeded OL Dynamic carrier row (matches id_reference on a fresh install). */
  olDynamicCarrierId: number;
  /** id_currency of PLN. */
  plnCurrencyId: number;
}

export interface ApplyFixtureOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Resources granted to the test WS API key. This is the union of every
 * resource the PrestaShop integration's adapters and resolvers touch via
 * PS WS — keep aligned with `PrestashopWebserviceClient` call sites.
 */
const WS_RESOURCES = [
  'carriers',
  'carts',
  'orders',
  'order_carriers',
  'order_states',
  'customers',
  'addresses',
  'products',
  'product_option_values',
  'combinations',
  'currencies',
  'languages',
  'countries',
  'states',
] as const;

/**
 * Apply the carrier-mapping fixture to a freshly auto-installed PS database.
 *
 * Caller is responsible for ensuring auto-install has completed — see the
 * `waitForPrestashopInstall` helper that polls `ps_configuration.PS_VERSION_DB`.
 */
export async function applyPrestashopFixture(
  options: ApplyFixtureOptions,
): Promise<PrestashopFixtureSeed> {
  const conn = await createConnection({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    multipleStatements: false,
  });

  try {
    const webserviceApiKey = randomBytes(16).toString('hex').toUpperCase();
    await seedWebserviceApiKey(conn, webserviceApiKey);
    const olDynamicCarrierId = await seedOlDynamicCarrier(conn);
    const plnCurrencyId = await seedPlnCurrency(conn);
    return { webserviceApiKey, olDynamicCarrierId, plnCurrencyId };
  } finally {
    await conn.end();
  }
}

/**
 * Detect the PS legacy-WebService schema variant present in this database.
 *
 * PrestaShop 8.x and earlier use:
 *   - `ps_api_access` (id_api_access, api_key, description, active)
 *   - `ps_api_access_resource` (id_api_access, resource, get/post/put/delete/head/all)
 *
 * PrestaShop 9.x renamed both tables to align with the new
 * `WebserviceKey` ObjectModel:
 *   - `ps_webservice_account` (id_webservice_account, key, description, active, ...)
 *   - `ps_webservice_account_permission` or `ps_webservice_permission`
 *     (varies by minor release)
 *
 * To stay forward-compatible, we probe `INFORMATION_SCHEMA.TABLES` for
 * the actual names and pick a matching code path. Throws a descriptive
 * error (with table list) if neither is found, so a future PS image
 * bump produces an actionable diagnostic instead of a `Table 'x' doesn't
 * exist` mid-test.
 */
interface WebserviceSchema {
  variant: 'legacy' | 'v9';
  /** account table (e.g. `ps_api_access` or `ps_webservice_account`) */
  accountTable: string;
  /** PK column on the account table */
  accountPk: string;
  /** API-key column on the account table */
  keyColumn: string;
  /** Per-resource permission table */
  permissionTable: string;
}

async function detectWebserviceSchema(conn: Connection): Promise<WebserviceSchema> {
  const [rows] = await conn.execute<(RowDataPacket & { TABLE_NAME: string })[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND (TABLE_NAME LIKE 'ps_%api%' OR TABLE_NAME LIKE 'ps_%webservice%')
     ORDER BY TABLE_NAME`,
  );
  const names = rows.map((r) => r.TABLE_NAME);
  const has = (name: string): boolean => names.includes(name);

  if (has('ps_api_access') && has('ps_api_access_resource')) {
    return {
      variant: 'legacy',
      accountTable: 'ps_api_access',
      accountPk: 'id_api_access',
      keyColumn: 'api_key',
      permissionTable: 'ps_api_access_resource',
    };
  }
  if (has('ps_webservice_account')) {
    // PS 9.x rolled the per-resource permission rows out into either
    // `ps_webservice_account_permission` or `ps_webservice_permission`
    // depending on the minor release. Pick whichever exists.
    const permTable =
      (has('ps_webservice_account_permission') && 'ps_webservice_account_permission') ||
      (has('ps_webservice_permission') && 'ps_webservice_permission') ||
      null;
    if (!permTable) {
      throw new Error(
        `PS 9.x WebService account table (ps_webservice_account) is present but ` +
          `no matching permission table found. Looked for: ` +
          `ps_webservice_account_permission, ps_webservice_permission. ` +
          `Tables matching ps_%api%|ps_%webservice%: [${names.join(', ')}]`,
      );
    }
    return {
      variant: 'v9',
      accountTable: 'ps_webservice_account',
      accountPk: 'id_webservice_account',
      keyColumn: 'key',
      permissionTable: permTable,
    };
  }

  throw new Error(
    `Cannot find a PrestaShop WebService account table. ` +
      `Looked for: ps_api_access (legacy 8.x) or ps_webservice_account (9.x). ` +
      `Tables matching ps_%api%|ps_%webservice%: [${names.join(', ')}]`,
  );
}

async function seedWebserviceApiKey(conn: Connection, apiKey: string): Promise<void> {
  const schema = await detectWebserviceSchema(conn);

  // Idempotency: if a row with this key exists, treat as already seeded. The
  // int-spec generates a fresh key per run so collisions only happen if the
  // same fixture is applied twice — re-asserting permissions is harmless.
  const [existingRows] = await conn.execute<RowDataPacket[]>(
    `SELECT \`${schema.accountPk}\` AS pk FROM \`${schema.accountTable}\` WHERE \`${schema.keyColumn}\` = ? LIMIT 1`,
    [apiKey],
  );
  let accountId: number;
  if (Array.isArray(existingRows) && existingRows.length > 0) {
    accountId = existingRows[0].pk as number;
  } else {
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO \`${schema.accountTable}\` (\`${schema.keyColumn}\`, description, active) VALUES (?, ?, 1)`,
      [apiKey, 'OpenLinker integration test key'],
    );
    accountId = result.insertId;
  }

  // Wipe and re-grant (cheap on a fresh install, idempotent on re-run).
  await conn.execute(
    `DELETE FROM \`${schema.permissionTable}\` WHERE \`${schema.accountPk}\` = ?`,
    [accountId],
  );

  // Both schema variants store per-resource ACLs as one row per (account, resource)
  // with bitfield-flagged HTTP verbs. Schema columns: account FK, resource,
  // get, post, put, delete, head, all. Granting `all=1` is the simplest way to
  // mirror the dev-stack admin's hand-configured key without enumerating verbs.
  for (const resource of WS_RESOURCES) {
    await conn.execute(
      `INSERT INTO \`${schema.permissionTable}\`
         (\`${schema.accountPk}\`, resource, \`get\`, \`post\`, \`put\`, \`delete\`, \`head\`, \`all\`)
       VALUES (?, ?, 1, 1, 1, 1, 1, 1)`,
      [accountId, resource],
    );
  }
}

async function seedOlDynamicCarrier(conn: Connection): Promise<number> {
  // Already seeded?
  const [existing] = await conn.execute<(RowDataPacket & { id_carrier: number })[]>(
    `SELECT id_carrier FROM ps_carrier
     WHERE external_module_name = 'openlinker' AND active = 1 AND deleted = 0
     LIMIT 1`,
  );
  if (Array.isArray(existing) && existing.length > 0) {
    return existing[0].id_carrier;
  }

  // Mirror the install shape from `apps/prestashop-module/openlinker/openlinker.php`
  // `installCarrier()` — id_tax_rules_group=0 so PS doesn't double-tax,
  // shipping_external=1 + is_module=1 so PS routes shipping cost calculation
  // to the OL module's `getOrderShippingCostExternal()`. The runtime path
  // also requires the module's PHP front controllers; this stub satisfies
  // only `discoverDynamicCarrierId()` (#516).
  const [insertResult] = await conn.execute<ResultSetHeader>(
    `INSERT INTO ps_carrier
       (id_reference, name, url,
        active, deleted, shipping_handling, range_behavior,
        is_module, is_free, shipping_external, need_range,
        external_module_name, shipping_method,
        position, max_width, max_height, max_depth, max_weight, grade,
        id_tax_rules_group)
     VALUES
       (0, 'OpenLinker Dynamic (test stub)', '',
        1, 0, 0, 0,
        1, 0, 1, 0,
        'openlinker', 0,
        99, 0, 0, 0, 0, 0,
        0)`,
  );
  const idCarrier = insertResult.insertId;
  // PS uses id_carrier as the new id_reference for first-installed rows.
  await conn.execute('UPDATE ps_carrier SET id_reference = ? WHERE id_carrier = ?', [idCarrier, idCarrier]);

  // Per-language delay strings (required by PS — empty-string delay is
  // tolerated but the row must exist for every active language and shop).
  const [langRows] = await conn.execute<(RowDataPacket & { id_lang: number })[]>(
    'SELECT id_lang FROM ps_lang WHERE active = 1',
  );
  const [shopRows] = await conn.execute<(RowDataPacket & { id_shop: number })[]>(
    'SELECT id_shop FROM ps_shop WHERE active = 1',
  );
  // ps_carrier_zone is required for PS to consider the carrier available;
  // grant against every zone to keep the fixture insensitive to country setup.
  // Hoisted out of the lang loop — zones don't change per language.
  const [zones] = await conn.execute<(RowDataPacket & { id_zone: number })[]>(
    'SELECT id_zone FROM ps_zone',
  );

  for (const lang of langRows) {
    for (const shop of shopRows) {
      await conn.execute(
        `INSERT INTO ps_carrier_lang (id_carrier, id_shop, id_lang, delay)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE delay = VALUES(delay)`,
        [idCarrier, shop.id_shop, lang.id_lang, 'OL dynamic test stub'],
      );
    }
  }

  for (const zone of zones) {
    await conn.execute(
      `INSERT IGNORE INTO ps_carrier_zone (id_carrier, id_zone) VALUES (?, ?)`,
      [idCarrier, zone.id_zone],
    );
  }

  for (const shop of shopRows) {
    await conn.execute(
      `INSERT IGNORE INTO ps_carrier_shop (id_carrier, id_shop) VALUES (?, ?)`,
      [idCarrier, shop.id_shop],
    );
  }

  return idCarrier;
}

async function seedPlnCurrency(conn: Connection): Promise<number> {
  const [existing] = await conn.execute<(RowDataPacket & { id_currency: number; deleted: number; active: number })[]>(
    'SELECT id_currency, deleted, active FROM ps_currency WHERE iso_code = ? LIMIT 1',
    ['PLN'],
  );
  if (Array.isArray(existing) && existing.length > 0) {
    const row = existing[0];
    if (row.deleted === 1 || row.active === 0) {
      await conn.execute(
        'UPDATE ps_currency SET deleted = 0, active = 1 WHERE id_currency = ?',
        [row.id_currency],
      );
    }
    await ensureCurrencyShopLink(conn, row.id_currency);
    await ensureCurrencyLangLink(conn, row.id_currency, 'Polish złoty', 'zł', 'PLN');
    return row.id_currency;
  }

  const [insertResult] = await conn.execute<ResultSetHeader>(
    `INSERT INTO ps_currency
       (iso_code, numeric_iso_code, precision, conversion_rate, deleted, active, unofficial, modified)
     VALUES
       ('PLN', '985', 2, 4.5, 0, 1, 0, 0)`,
  );
  const idCurrency = insertResult.insertId;
  await ensureCurrencyShopLink(conn, idCurrency);
  await ensureCurrencyLangLink(conn, idCurrency, 'Polish złoty', 'zł', 'PLN');
  return idCurrency;
}

async function ensureCurrencyShopLink(conn: Connection, idCurrency: number): Promise<void> {
  const [shops] = await conn.execute<(RowDataPacket & { id_shop: number })[]>(
    'SELECT id_shop FROM ps_shop WHERE active = 1',
  );
  for (const shop of shops) {
    await conn.execute(
      `INSERT IGNORE INTO ps_currency_shop (id_currency, id_shop, conversion_rate)
       VALUES (?, ?, 4.5)`,
      [idCurrency, shop.id_shop],
    );
  }
}

async function ensureCurrencyLangLink(
  conn: Connection,
  idCurrency: number,
  name: string,
  symbol: string,
  isoCode: string,
): Promise<void> {
  const [langs] = await conn.execute<(RowDataPacket & { id_lang: number })[]>(
    'SELECT id_lang FROM ps_lang WHERE active = 1',
  );
  for (const lang of langs) {
    await conn.execute(
      `INSERT INTO ps_currency_lang (id_currency, id_lang, name, symbol, pattern)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), symbol = VALUES(symbol)`,
      [idCurrency, lang.id_lang, name, symbol, `#,##0.00 ${isoCode}`],
    );
  }
}

/**
 * Poll the PS install marker until non-null or the deadline expires.
 *
 * PS auto-install writes `ps_configuration.PS_VERSION_DB` only at the very
 * end of install. This is the most reliable completion signal — HTTP probes
 * race the install (the storefront responds before all configuration rows
 * are written).
 *
 * @param options - mysql2 connection options
 * @param timeoutMs - deadline; throws on expiry
 */
export async function waitForPrestashopInstall(
  options: ApplyFixtureOptions,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const conn = await createConnection({
        host: options.host,
        port: options.port,
        user: options.user,
        password: options.password,
        database: options.database,
      });
      try {
        const [rows] = await conn.execute<(RowDataPacket & { value: string | null })[]>(
          "SELECT value FROM ps_configuration WHERE name = 'PS_VERSION_DB' LIMIT 1",
        );
        if (
          Array.isArray(rows) &&
          rows.length > 0 &&
          rows[0].value !== null &&
          rows[0].value !== ''
        ) {
          return;
        }
      } finally {
        await conn.end();
      }
    } catch {
      // MySQL may be reachable before PS finished creating tables; swallow
      // and retry. The outer deadline is the cap.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `PrestaShop auto-install did not complete within ${timeoutMs}ms (no ps_configuration.PS_VERSION_DB row)`,
  );
}
