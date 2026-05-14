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
import { createConnection, Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

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
  // Used by PrestashopWebhookProvisioningAdapter to write OPENLINKER_*
  // rows (#168 / #541). Carrier-mapping smoke spec doesn't touch this
  // resource, so adding it here is purely additive.
  'configurations',
] as const;

/**
 * Apply the carrier-mapping fixture to a freshly auto-installed PS database.
 *
 * Caller is responsible for ensuring auto-install has completed — see the
 * `waitForPrestashopInstall` helper that polls `ps_configuration.PS_VERSION_DB`.
 */
export async function applyPrestashopFixture(
  options: ApplyFixtureOptions
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
    // PS install with PS_COUNTRY=US activates only US/EU; the carrier-mapping
    // spec (#535) routes Polish orders, so flip the PL row to active. No-op
    // when PL is already active (fresh PS_COUNTRY=PL installs).
    await activateCountry(conn, 'PL');
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
  /**
   * Permission row shape:
   *   - 'bitfield': one row per (account, resource) with get/post/put/delete/head/all columns
   *     (PS ≤ 8.x).
   *   - 'method-row': one row per (account, resource, method) where method is an ENUM
   *     ('GET','POST','PUT','DELETE','HEAD') — PS 9.x.
   */
  permissionShape: 'bitfield' | 'method-row';
}

async function detectWebserviceSchema(conn: Connection): Promise<WebserviceSchema> {
  const [rows] = await conn.execute<(RowDataPacket & { TABLE_NAME: string })[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND (TABLE_NAME LIKE 'ps_%api%' OR TABLE_NAME LIKE 'ps_%webservice%')
     ORDER BY TABLE_NAME`
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
      permissionShape: 'bitfield',
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
          `Tables matching ps_%api%|ps_%webservice%: [${names.join(', ')}]`
      );
    }
    // Inspect the permission table column layout to choose the insert
    // shape. PS 9.x uses one row per (account, resource, method) with a
    // `method` ENUM column; the older bitfield layout (get/post/put/...
    // boolean columns) was retired in this transition. Probing the
    // column list keeps the helper resilient to either, which matters
    // because the rename + reshape didn't always land in lockstep
    // across PS 9.x point releases.
    const [permCols] = await conn.execute<(RowDataPacket & { COLUMN_NAME: string })[]>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [permTable]
    );
    const colNames = permCols.map((r) => r.COLUMN_NAME.toLowerCase());
    const hasMethodColumn = colNames.includes('method');
    const hasBitfieldColumns = colNames.includes('get') && colNames.includes('post');
    const shape: WebserviceSchema['permissionShape'] = hasMethodColumn
      ? 'method-row'
      : hasBitfieldColumns
        ? 'bitfield'
        : (() => {
            throw new Error(
              `PS WebService permission table ${permTable} has neither a 'method' column ` +
                `nor get/post/put/delete/head bitfield columns. Columns: [${colNames.join(', ')}]`
            );
          })();
    return {
      variant: 'v9',
      accountTable: 'ps_webservice_account',
      accountPk: 'id_webservice_account',
      keyColumn: 'key',
      permissionTable: permTable,
      permissionShape: shape,
    };
  }

  throw new Error(
    `Cannot find a PrestaShop WebService account table. ` +
      `Looked for: ps_api_access (legacy 8.x) or ps_webservice_account (9.x). ` +
      `Tables matching ps_%api%|ps_%webservice%: [${names.join(', ')}]`
  );
}

/** HTTP methods to grant on every resource — same set as the dev-stack hand-configured key. */
const WS_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'] as const;

async function seedWebserviceApiKey(conn: Connection, apiKey: string): Promise<void> {
  const schema = await detectWebserviceSchema(conn);

  // Idempotency: if a row with this key exists, treat as already seeded. The
  // int-spec generates a fresh key per run so collisions only happen if the
  // same fixture is applied twice — re-asserting permissions is harmless.
  const [existingRows] = await conn.execute<RowDataPacket[]>(
    `SELECT \`${schema.accountPk}\` AS pk FROM \`${schema.accountTable}\` WHERE \`${schema.keyColumn}\` = ? LIMIT 1`,
    [apiKey]
  );
  let accountId: number;
  if (Array.isArray(existingRows) && existingRows.length > 0) {
    accountId = existingRows[0].pk as number;
  } else {
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO \`${schema.accountTable}\` (\`${schema.keyColumn}\`, description, active) VALUES (?, ?, 1)`,
      [apiKey, 'OpenLinker integration test key']
    );
    accountId = result.insertId;
  }

  // Wipe and re-grant (cheap on a fresh install, idempotent on re-run).
  await conn.execute(
    `DELETE FROM \`${schema.permissionTable}\` WHERE \`${schema.accountPk}\` = ?`,
    [accountId]
  );

  // PS 9.x: bind the WS account to all active shops via ps_webservice_account_shop.
  // Without this junction the account is "unbound" and every WS call 503s
  // "The PrestaShop webservice is disabled" with PSWS-Version: 0 — even when
  // PS_WEBSERVICE is enabled. Confirmed locally with a manual repro.
  if (schema.variant === 'v9') {
    const [shopJunctionRows] = await conn.execute<(RowDataPacket & { TABLE_NAME: string })[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ps_webservice_account_shop'`
    );
    if (shopJunctionRows.length > 0) {
      const [shopRows] = await conn.execute<(RowDataPacket & { id_shop: number })[]>(
        'SELECT id_shop FROM ps_shop WHERE active = 1'
      );
      for (const shop of shopRows) {
        await conn.execute(
          `INSERT IGNORE INTO ps_webservice_account_shop (id_webservice_account, id_shop)
           VALUES (?, ?)`,
          [accountId, shop.id_shop]
        );
      }
    }
  }

  if (schema.permissionShape === 'bitfield') {
    // Legacy schema: one row per (account, resource) with bitfield-flagged
    // HTTP verbs. `all=1` mirrors a "grant everything" key.
    for (const resource of WS_RESOURCES) {
      await conn.execute(
        `INSERT INTO \`${schema.permissionTable}\`
           (\`${schema.accountPk}\`, resource, \`get\`, \`post\`, \`put\`, \`delete\`, \`head\`, \`all\`)
         VALUES (?, ?, 1, 1, 1, 1, 1, 1)`,
        [accountId, resource]
      );
    }
  } else {
    // PS 9.x: one row per (account, resource, method) where method is an
    // ENUM. Insert one row per HTTP verb per resource.
    for (const resource of WS_RESOURCES) {
      for (const method of WS_METHODS) {
        await conn.execute(
          `INSERT INTO \`${schema.permissionTable}\`
             (\`${schema.accountPk}\`, resource, method)
           VALUES (?, ?, ?)`,
          [accountId, resource, method]
        );
      }
    }
  }
}

async function seedOlDynamicCarrier(conn: Connection): Promise<number> {
  // Already seeded? Includes the case where the real OL PS module has been
  // installed by the test harness (#692) — the install hook creates the
  // carrier row with the same `external_module_name='openlinker'` shape.
  const [existing] = await conn.execute<(RowDataPacket & { id_carrier: number })[]>(
    `SELECT id_carrier FROM ps_carrier
     WHERE external_module_name = 'openlinker' AND active = 1 AND deleted = 0
     LIMIT 1`
  );
  if (Array.isArray(existing) && existing.length > 0) {
    const existingId = existing[0].id_carrier;
    // The module install's `Zone::getZones(true)` snapshot fires BEFORE
    // `activateCountry(PL)` below — so the PL zone (newly activated by
    // applyPrestashopFixture) isn't yet linked to the OL Dynamic carrier.
    // PS's carrier-validation pass at POST /orders then rejects the OL
    // Dynamic carrier as unavailable for a PL delivery address and falls
    // back to the next available carrier (myCheapCarrier), breaking S-3.
    // Top up zone links idempotently here so newly-activated zones (PL)
    // are always covered, regardless of install ordering.
    await linkCarrierToAllZones(conn, existingId);
    return existingId;
  }

  // Build the INSERT dynamically from the actual `ps_carrier` columns that
  // exist in this PS version. The legacy `id_tax_rules_group` column was
  // removed in PS 9.x; other columns may follow. Probing INFORMATION_SCHEMA
  // makes the fixture resilient to additions/removals — we only insert
  // columns we have a value for AND that the live table accepts. The OL
  // module's `installCarrier()` (apps/prestashop-module/openlinker/openlinker.php)
  // remains the source of truth for what the carrier row must look like to
  // make `discoverDynamicCarrierId()` happy; this stub is the minimal
  // intersection of that and the test's needs.
  const desiredColumns: Record<string, string | number> = {
    id_reference: 0,
    name: 'OpenLinker Dynamic (test stub)',
    url: '',
    active: 1,
    deleted: 0,
    shipping_handling: 0,
    range_behavior: 0,
    is_module: 1,
    is_free: 0,
    shipping_external: 1,
    need_range: 0,
    external_module_name: 'openlinker',
    shipping_method: 0,
    position: 99,
    max_width: 0,
    max_height: 0,
    max_depth: 0,
    max_weight: 0,
    grade: 0,
    // Legacy PS ≤ 8.x — silently dropped if the column doesn't exist in 9.x+.
    id_tax_rules_group: 0,
  };

  await assertNoUnsuppliedNotNullColumns(conn, 'ps_carrier', desiredColumns);
  const insertResult = await dynamicInsert(conn, 'ps_carrier', desiredColumns);
  const idCarrier = insertResult.insertId;
  // PS uses id_carrier as the new id_reference for first-installed rows.
  await conn.execute('UPDATE ps_carrier SET id_reference = ? WHERE id_carrier = ?', [
    idCarrier,
    idCarrier,
  ]);

  // Belt-and-braces: the resolution chain relies on id_carrier == id_reference
  // for first-installed carriers (#535 carrier-mapping spec assumes the two
  // coincide so callers can pass either value as `prestashopCarrierId`). If a
  // future PS image changes that invariant the spec needs to know — surface
  // it here with a precise message rather than at the assertion line.
  const [verifyRows] = await conn.execute<
    (RowDataPacket & { id_carrier: number; id_reference: number })[]
  >('SELECT id_carrier, id_reference FROM ps_carrier WHERE id_carrier = ?', [idCarrier]);
  const row = verifyRows[0];
  if (!row || row.id_carrier !== row.id_reference) {
    throw new Error(
      `OL Dynamic carrier seed: post-insert id_carrier=${row?.id_carrier} != id_reference=${row?.id_reference}. ` +
        `Update the carrier-mapping spec to track id_reference and id_carrier separately.`
    );
  }

  // Per-language delay strings (required by PS — empty-string delay is
  // tolerated but the row must exist for every active language and shop).
  const [langRows] = await conn.execute<(RowDataPacket & { id_lang: number })[]>(
    'SELECT id_lang FROM ps_lang WHERE active = 1'
  );
  const [shopRows] = await conn.execute<(RowDataPacket & { id_shop: number })[]>(
    'SELECT id_shop FROM ps_shop WHERE active = 1'
  );
  // ps_carrier_zone is required for PS to consider the carrier available;
  // grant against every zone to keep the fixture insensitive to country setup.
  // Hoisted out of the lang loop — zones don't change per language.
  const [zones] = await conn.execute<(RowDataPacket & { id_zone: number })[]>(
    'SELECT id_zone FROM ps_zone'
  );

  for (const lang of langRows) {
    for (const shop of shopRows) {
      await conn.execute(
        `INSERT INTO ps_carrier_lang (id_carrier, id_shop, id_lang, delay)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE delay = VALUES(delay)`,
        [idCarrier, shop.id_shop, lang.id_lang, 'OL dynamic test stub']
      );
    }
  }

  for (const zone of zones) {
    await conn.execute(`INSERT IGNORE INTO ps_carrier_zone (id_carrier, id_zone) VALUES (?, ?)`, [
      idCarrier,
      zone.id_zone,
    ]);
  }

  for (const shop of shopRows) {
    await conn.execute(`INSERT IGNORE INTO ps_carrier_shop (id_carrier, id_shop) VALUES (?, ?)`, [
      idCarrier,
      shop.id_shop,
    ]);
  }

  return idCarrier;
}

/**
 * Link a carrier to every zone in `ps_zone` (no active filter). Idempotent —
 * uses `INSERT IGNORE` so re-running against an already-linked carrier is a
 * no-op. Used by `seedOlDynamicCarrier`'s early-return path (#692) to keep
 * the module-installed-carrier branch on par with the SQL-stub-insert branch
 * below, which already does the same zone-link loop. The real OL PS module's
 * install hook only links to zones that were active at PS install time
 * (`Zone::getZones(true)`); this helper backfills any zone added later (e.g.
 * by a future fixture step that activates a new zone), preventing a class of
 * carrier-availability failures from drifting in silently.
 */
async function linkCarrierToAllZones(conn: Connection, idCarrier: number): Promise<void> {
  const [zones] = await conn.execute<(RowDataPacket & { id_zone: number })[]>(
    'SELECT id_zone FROM ps_zone'
  );
  for (const zone of zones) {
    await conn.execute(
      'INSERT IGNORE INTO ps_carrier_zone (id_carrier, id_zone) VALUES (?, ?)',
      [idCarrier, zone.id_zone]
    );
  }
}

/**
 * Activate a country by ISO2 in `ps_country` and ensure it's assigned to an
 * existing zone. PS installs with `PS_COUNTRY=US` leave many countries
 * inactive (`active=0`) AND may leave `id_zone=0`, which collapses the
 * country's carrier-zone match (#467 — zone-zero zeroes `total_shipping`).
 *
 * Strategy:
 *   1. Force `active = 1`.
 *   2. If `id_zone = 0`, pick the lowest active zone id and assign it.
 *      The seeded carriers grant against all zones via `ps_carrier_zone`,
 *      so any non-zero zone is accepted.
 *
 * Idempotent — re-running against an already-active, zone-linked country
 * is a no-op.
 */
async function activateCountry(conn: Connection, iso2: string): Promise<void> {
  await conn.execute('UPDATE ps_country SET active = 1 WHERE iso_code = ?', [iso2]);
  const [zoneCheck] = await conn.execute<(RowDataPacket & { id_zone: number })[]>(
    'SELECT id_zone FROM ps_country WHERE iso_code = ? LIMIT 1',
    [iso2]
  );
  if (zoneCheck.length === 0 || Number(zoneCheck[0].id_zone) > 0) {
    return;
  }
  const [zones] = await conn.execute<(RowDataPacket & { id_zone: number })[]>(
    'SELECT id_zone FROM ps_zone WHERE active = 1 ORDER BY id_zone ASC LIMIT 1'
  );
  if (zones.length === 0) {
    return;
  }
  await conn.execute('UPDATE ps_country SET id_zone = ? WHERE iso_code = ?', [
    zones[0].id_zone,
    iso2,
  ]);
}

async function seedPlnCurrency(conn: Connection): Promise<number> {
  const [existing] = await conn.execute<
    (RowDataPacket & { id_currency: number; deleted: number; active: number })[]
  >('SELECT id_currency, deleted, active FROM ps_currency WHERE iso_code = ? LIMIT 1', ['PLN']);
  if (Array.isArray(existing) && existing.length > 0) {
    const row = existing[0];
    if (row.deleted === 1 || row.active === 0) {
      await conn.execute('UPDATE ps_currency SET deleted = 0, active = 1 WHERE id_currency = ?', [
        row.id_currency,
      ]);
    }
    await ensureCurrencyShopLink(conn, row.id_currency);
    await ensureCurrencyLangLink(conn, row.id_currency, 'Polish złoty', 'zł', 'PLN');
    return row.id_currency;
  }

  // Same dynamic-column trick as `seedOlDynamicCarrier`: PS 9.x dropped /
  // renamed columns on `ps_currency`. Insert only what the live table has.
  const desiredCurrencyColumns: Record<string, string | number> = {
    iso_code: 'PLN',
    numeric_iso_code: '985',
    precision: 2,
    // Set 1:1 to the shop's default currency so PS doesn't multiply order
    // totals through a conversion factor. The carrier-mapping spec (#535)
    // wants `total_shipping == 12.50` literally; a 4.5x conversion blew that
    // up to 56.25 in the order currency. The realism cost of an unrealistic
    // exchange rate is negligible for a fixture that never quotes prices
    // outside the test.
    conversion_rate: 1.0,
    deleted: 0,
    active: 1,
    // Legacy in some 8.x → maybe absent in 9.x.
    unofficial: 0,
    modified: 0,
    // Added in PS 9.x — ps_currency now stores the canonical name/symbol/pattern
    // on the row itself; per-language overrides still go to ps_currency_lang
    // via ensureCurrencyLangLink below.
    name: 'Polish złoty',
    symbol: 'zł',
    pattern: '#,##0.00 PLN',
  };
  await assertNoUnsuppliedNotNullColumns(conn, 'ps_currency', desiredCurrencyColumns);
  const insertResult = await dynamicInsert(conn, 'ps_currency', desiredCurrencyColumns);
  const idCurrency = insertResult.insertId;
  await ensureCurrencyShopLink(conn, idCurrency);
  await ensureCurrencyLangLink(conn, idCurrency, 'Polish złoty', 'zł', 'PLN');
  return idCurrency;
}

async function ensureCurrencyShopLink(conn: Connection, idCurrency: number): Promise<void> {
  const [shops] = await conn.execute<(RowDataPacket & { id_shop: number })[]>(
    'SELECT id_shop FROM ps_shop WHERE active = 1'
  );
  for (const shop of shops) {
    await conn.execute(
      `INSERT IGNORE INTO ps_currency_shop (id_currency, id_shop, conversion_rate)
       VALUES (?, ?, 1.0)`,
      [idCurrency, shop.id_shop]
    );
  }
}

async function ensureCurrencyLangLink(
  conn: Connection,
  idCurrency: number,
  name: string,
  symbol: string,
  isoCode: string
): Promise<void> {
  const [langs] = await conn.execute<(RowDataPacket & { id_lang: number })[]>(
    'SELECT id_lang FROM ps_lang WHERE active = 1'
  );
  for (const lang of langs) {
    await conn.execute(
      `INSERT INTO ps_currency_lang (id_currency, id_lang, name, symbol, pattern)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), symbol = VALUES(symbol)`,
      [idCurrency, lang.id_lang, name, symbol, `#,##0.00 ${isoCode}`]
    );
  }
}

/**
 * INSERT one row into a PS table using only columns that exist in the live
 * schema. Resilient to PS version drift — extra desired columns are
 * silently dropped, missing required columns produce a precise error.
 */
async function dynamicInsert(
  conn: Connection,
  table: string,
  desired: Record<string, string | number>
): Promise<ResultSetHeader> {
  const [cols] = await conn.execute<(RowDataPacket & { COLUMN_NAME: string })[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  const liveCols = new Set(cols.map((r) => r.COLUMN_NAME));
  const usedCols = Object.keys(desired).filter((c) => liveCols.has(c));
  if (usedCols.length === 0) {
    throw new Error(
      `${table} has none of the expected columns. Live columns: [${Array.from(liveCols).join(', ')}]`
    );
  }
  const placeholders = usedCols.map(() => '?').join(', ');
  const colList = usedCols.map((c) => `\`${c}\``).join(', ');
  const values = usedCols.map((c) => desired[c]);
  const [result] = await conn.execute<ResultSetHeader>(
    `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders})`,
    values
  );
  return result;
}

/**
 * Upsert one row, only inserting columns the live schema actually has.
 *
 * Used by helpers that bridge against PS tables whose column layout shifts
 * between minor versions (e.g. `ps_product_lang` lost `meta_keywords` in
 * 9.x). Falls back to `INSERT ... ON DUPLICATE KEY UPDATE` updating only
 * columns that survived the filter.
 */
async function upsertDynamicByColumnPresence(
  conn: Connection,
  table: string,
  pkColumns: string[],
  desired: Record<string, string | number>
): Promise<void> {
  const [cols] = await conn.execute<(RowDataPacket & { COLUMN_NAME: string })[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  const liveCols = new Set(cols.map((r) => r.COLUMN_NAME));
  const usedCols = Object.keys(desired).filter((c) => liveCols.has(c));
  if (usedCols.length === 0) {
    throw new Error(
      `${table} has none of the expected columns. Live columns: [${Array.from(liveCols).join(', ')}]`
    );
  }
  const placeholders = usedCols.map(() => '?').join(', ');
  const colList = usedCols.map((c) => `\`${c}\``).join(', ');
  const updateSet = usedCols
    .filter((c) => !pkColumns.includes(c))
    .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
    .join(', ');
  const values = usedCols.map((c) => desired[c]);
  const sql = updateSet
    ? `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateSet}`
    : `INSERT IGNORE INTO \`${table}\` (${colList}) VALUES (${placeholders})`;
  await conn.execute(sql, values);
}

/**
 * Throw if the live table has any NOT-NULL columns (with no default) that
 * we don't have a value for. Catches the "Field 'name' doesn't have a
 * default value" pattern at fixture-build time with a precise list of
 * what's missing — turning N CI iterations into 1.
 */
async function assertNoUnsuppliedNotNullColumns(
  conn: Connection,
  table: string,
  desired: Record<string, string | number>
): Promise<void> {
  const [cols] = await conn.execute<
    (RowDataPacket & {
      COLUMN_NAME: string;
      IS_NULLABLE: string;
      COLUMN_DEFAULT: string | null;
      EXTRA: string;
    })[]
  >(
    `SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  const supplied = new Set(Object.keys(desired));
  const missingRequired = cols
    .filter(
      (c) =>
        c.IS_NULLABLE === 'NO' &&
        c.COLUMN_DEFAULT === null &&
        !c.EXTRA.includes('auto_increment') &&
        !supplied.has(c.COLUMN_NAME)
    )
    .map((c) => c.COLUMN_NAME);
  if (missingRequired.length > 0) {
    throw new Error(
      `${table} has NOT-NULL columns without a default that aren't in the desired map: ` +
        `[${missingRequired.join(', ')}]. Add values for these to the desired map.`
    );
  }
}

/**
 * Update PS configuration so the shop is reachable from outside the container
 * via testcontainers' mapped host:port — not via the install-time PS_DOMAIN
 * (which is "localhost" without a port and fails for any caller hitting the
 * mapped port). Also disables URL rewriting + SSL redirects so the WS probe
 * gets a clean response instead of a 302 to the "canonical" URL.
 *
 * Touches:
 *   - `ps_shop_url`: sets the registered domain rows so PS sees `<host>:<port>` as canonical.
 *   - `ps_configuration`: disables PS_SSL_ENABLED, PS_REWRITING_SETTINGS, PS_FORCE_SMARTY_2.
 *
 * Idempotent — safe to run multiple times against the same DB.
 */
export async function configurePrestashopAccessUrl(
  options: ApplyFixtureOptions,
  externalHostPort: string
): Promise<void> {
  const conn = await createConnection({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    multipleStatements: false,
  });
  try {
    // ps_shop_url controls which (domain, physical_uri) tuple PS treats as
    // canonical for each shop. The default install seeds `localhost` with
    // no port; updating to the real host:port silences PS's
    // canonical-URL redirect in `Tools::redirectCanonical`.
    await conn.execute(
      `UPDATE ps_shop_url
         SET domain = ?, domain_ssl = ?, physical_uri = '/'
       WHERE main = 1`,
      [externalHostPort, externalHostPort]
    );

    // Configuration values we want to override so PS doesn't 302 the WS:
    //   - PS_SSL_ENABLED / PS_SSL_ENABLED_EVERYWHERE: keep HTTP-only.
    //   - PS_REWRITING_SETTINGS: 0 = don't rely on .htaccess being generated
    //     (the install doesn't write one; /api/* would otherwise hit the
    //     storefront router and 302 home).
    //   - PS_SHOP_DOMAIN / PS_SHOP_DOMAIN_SSL: also stored in
    //     ps_configuration in some PS versions; align with ps_shop_url.
    const overrides: Array<[string, string]> = [
      ['PS_SSL_ENABLED', '0'],
      ['PS_SSL_ENABLED_EVERYWHERE', '0'],
      ['PS_REWRITING_SETTINGS', '0'],
      ['PS_SHOP_DOMAIN', externalHostPort],
      ['PS_SHOP_DOMAIN_SSL', externalHostPort],
      // PS 9.x ships with the WebService DISABLED by default. Without this,
      // every authenticated WS request returns 503 "The PrestaShop
      // webservice is disabled. Please activate it in the PrestaShop Back
      // Office" — confirmed locally with a manual repro before this commit.
      ['PS_WEBSERVICE', '1'],
      // Surface PHP / PS errors in the WS response body — without this a
      // 500 returns an empty <prestashop/> envelope and the test runner
      // sees only "PrestaShop API server error (500)" with no diagnostic.
      ['PS_DEV_MODE', '1'],
    ];
    for (const [name, value] of overrides) {
      await conn.execute(
        `INSERT INTO ps_configuration (name, value, date_add, date_upd)
         VALUES (?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE value = VALUES(value), date_upd = NOW()`,
        [name, value]
      );
    }
  } finally {
    await conn.end();
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
  timeoutMs: number
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
          "SELECT value FROM ps_configuration WHERE name = 'PS_VERSION_DB' LIMIT 1"
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
    `PrestaShop auto-install did not complete within ${timeoutMs}ms (no ps_configuration.PS_VERSION_DB row)`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Carrier-mapping vertical-slice helpers (#535)
// ─────────────────────────────────────────────────────────────────────────

export interface PrestashopCarrierInfo {
  idCarrier: number;
  idReference: number;
}

export interface DefaultPrestashopCarriers {
  /**
   * Primary test carrier. Used by S-1 as the mapped target.
   * Sourced from the first non-OL active carrier on the seeded PS install
   * (typically "My carrier" `id_carrier=2`).
   */
  myCarrier: PrestashopCarrierInfo;
  /**
   * Secondary test carrier. Used by S-2 as the
   * `connection.config.defaultCarrierId` fallback target. Distinct from
   * `myCarrier` so S-1 and S-2 assertions exercise different `id_carrier`
   * values.
   *
   * PS 9.x defaults to a single non-OL carrier on a clean install, so this
   * helper seeds an additional carrier when needed and returns its row.
   */
  myCheapCarrier: PrestashopCarrierInfo;
}

/**
 * Resolve two distinct PS carriers the carrier-mapping spec routes orders to.
 *
 * Strategy:
 *   1. Query all active non-OL carriers (excluding `external_module_name='openlinker'`).
 *   2. If two or more exist, return the first two by `id_carrier` ASC.
 *   3. If only one exists, dynamically seed a second test carrier alongside
 *      and return both. The seeded carrier mirrors the existing one's
 *      structure (zone + language rows) so PS treats it as a real carrier
 *      with full delivery coverage — required for `total_shipping` to
 *      survive the #467 zone-zero wipe.
 */
export async function getDefaultPsCarriers(
  options: ApplyFixtureOptions
): Promise<DefaultPrestashopCarriers> {
  const conn = await createConnection({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    multipleStatements: false,
  });
  try {
    // PS 9.x seeds 3 default carriers: "Click and collect" (1), "My carrier" (2),
    // "My cheap carrier" (3) — but only 1 + 2 are active by default. Force-activate
    // "My cheap carrier" so we have two distinct *real* carriers for the spec.
    await conn.execute(
      `UPDATE ps_carrier SET active = 1 WHERE name = 'My cheap carrier' AND deleted = 0`
    );
    // Deactivate "Click and collect" — it's a pickup-only carrier that PS treats
    // specially in cart resolution: even when our adapter explicitly requests
    // `id_carrier=2`/`3`, PS rewrites to carrier 1 if it's available. Disabling
    // it removes the fallback target so PS honours the requested carrier.
    await conn.execute(
      `UPDATE ps_carrier SET active = 0 WHERE name = 'Click and collect' AND deleted = 0`
    );

    // Order matters here: PS's cart resolution favours the carrier with the
    // lowest position/id_carrier when a requested carrier fails availability
    // validation. Putting "My cheap carrier" (id 3) first as `myCarrier` and
    // "My carrier" (id 2) second as `myCheapCarrier` reverses the install
    // semantic order but keeps the spec's two assertions on distinct ids.
    // The names are positional only — the spec doesn't care about labels.
    const existing = await listActiveNonOlCarriersByName(conn, ['My cheap carrier', 'My carrier']);
    let pair: DefaultPrestashopCarriers;
    if (existing.length >= 2) {
      pair = { myCarrier: existing[0], myCheapCarrier: existing[1] };
    } else if (existing.length === 1) {
      const secondary = await seedSecondaryTestCarrier(conn);
      pair = { myCarrier: existing[0], myCheapCarrier: secondary };
    } else {
      throw new Error(
        `No active "My carrier"/"My cheap carrier" rows found on the PS install. ` +
          `Check the install's PS_COUNTRY / carrier seed.`
      );
    }

    // Both carriers must be fully wired to land an order on a Polish address
    // with non-zero shipping. Pre-seeded PS carriers may carry stub
    // ps_delivery rows tied to PS_COUNTRY=US zones only — top them up.
    await ensureCarrierFullyDelivered(conn, pair.myCarrier.idCarrier);
    await ensureCarrierFullyDelivered(conn, pair.myCheapCarrier.idCarrier);
    return pair;
  } finally {
    await conn.end();
  }
}

/**
 * Variant of the active-non-OL carrier query that filters by specific carrier names.
 *
 * Used by the carrier-mapping spec to skip PS's "Click and collect" default
 * (which PS treats specially during cart resolution and tends to re-pick
 * over a requested `id_carrier`, masking the OL routing under test).
 */
async function listActiveNonOlCarriersByName(
  conn: Connection,
  names: string[]
): Promise<PrestashopCarrierInfo[]> {
  if (names.length === 0) return [];
  const placeholders = names.map(() => '?').join(', ');
  const [rows] = await conn.execute<
    (RowDataPacket & { id_carrier: number; id_reference: number; name: string })[]
  >(
    `SELECT id_carrier, id_reference, name
     FROM ps_carrier
     WHERE active = 1 AND deleted = 0
       AND (external_module_name IS NULL OR external_module_name <> 'openlinker')
       AND name IN (${placeholders})
     ORDER BY FIELD(name, ${placeholders})`,
    [...names, ...names]
  );
  return rows.map((row) => ({ idCarrier: row.id_carrier, idReference: row.id_reference }));
}

/**
 * Seed a second test carrier so S-2 can land orders on a distinct `id_carrier`
 * value from S-1. Mirrors the OL Dynamic seed shape (active, zone-linked,
 * shop-linked, per-language delay row) but flips `is_module=0` so it looks
 * like an ordinary in-shop carrier rather than an external-module one.
 */
async function seedSecondaryTestCarrier(conn: Connection): Promise<PrestashopCarrierInfo> {
  const desiredColumns: Record<string, string | number> = {
    id_reference: 0,
    name: 'OL Test Secondary Carrier',
    url: '',
    active: 1,
    deleted: 0,
    shipping_handling: 0,
    range_behavior: 0,
    is_module: 0,
    is_free: 0,
    shipping_external: 0,
    need_range: 0,
    external_module_name: '',
    shipping_method: 0,
    position: 100,
    max_width: 0,
    max_height: 0,
    max_depth: 0,
    max_weight: 0,
    grade: 0,
    id_tax_rules_group: 0,
  };
  await assertNoUnsuppliedNotNullColumns(conn, 'ps_carrier', desiredColumns);
  const insertResult = await dynamicInsert(conn, 'ps_carrier', desiredColumns);
  const idCarrier = insertResult.insertId;
  await conn.execute('UPDATE ps_carrier SET id_reference = ? WHERE id_carrier = ?', [
    idCarrier,
    idCarrier,
  ]);

  const [langRows] = await conn.execute<(RowDataPacket & { id_lang: number })[]>(
    'SELECT id_lang FROM ps_lang WHERE active = 1'
  );
  const [shopRows] = await conn.execute<(RowDataPacket & { id_shop: number })[]>(
    'SELECT id_shop FROM ps_shop WHERE active = 1'
  );
  const [zones] = await conn.execute<(RowDataPacket & { id_zone: number })[]>(
    'SELECT id_zone FROM ps_zone'
  );

  for (const lang of langRows) {
    for (const shop of shopRows) {
      await conn.execute(
        `INSERT INTO ps_carrier_lang (id_carrier, id_shop, id_lang, delay)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE delay = VALUES(delay)`,
        [idCarrier, shop.id_shop, lang.id_lang, 'Test secondary carrier']
      );
    }
  }
  for (const zone of zones) {
    await conn.execute('INSERT IGNORE INTO ps_carrier_zone (id_carrier, id_zone) VALUES (?, ?)', [
      idCarrier,
      zone.id_zone,
    ]);
  }
  for (const shop of shopRows) {
    await conn.execute('INSERT IGNORE INTO ps_carrier_shop (id_carrier, id_shop) VALUES (?, ?)', [
      idCarrier,
      shop.id_shop,
    ]);
  }

  // ps_delivery is the carrier price/weight matrix. Without at least one row
  // PS treats the carrier as having no delivery zones (carries `total_shipping=0`,
  // reproduces #467) and may fall back to the first available carrier on the
  // cart instead of honouring the requested `id_carrier`. One flat-rate row per
  // zone (range 0–10000 in BOTH `range_price` and `range_weight` so it's
  // permissive regardless of `shipping_method`) is enough.
  await seedDeliveryRows(conn, idCarrier, zones, shopRows);

  return { idCarrier, idReference: idCarrier };
}

/**
 * Wipe + re-seed delivery infrastructure for the given carrier so the spec
 * is insensitive to PS install defaults. Replaces any stock ps_delivery /
 * ps_range_price / ps_range_weight rows for the carrier with one flat-rate
 * 12.50 row per zone (covering 0–10000 in both price and weight), plus
 * `range_behavior=1` ("apply highest if cart out of range") and
 * `shipping_handling=0`.
 *
 * Why wipe: PS 9.0.2 seeds "My carrier" and "My cheap carrier" with narrow
 * price ranges (e.g. 0–50 EUR) that don't cover a 100 PLN cart, causing PS
 * to silently mark the carrier unavailable and rewrite `id_carrier` back
 * to "Click and collect" during cart resolution. The carrier-mapping spec
 * needs the carriers to be unambiguously available regardless of cart size.
 */
async function ensureCarrierFullyDelivered(conn: Connection, idCarrier: number): Promise<void> {
  const [zones] = await conn.execute<(RowDataPacket & { id_zone: number })[]>(
    'SELECT id_zone FROM ps_zone WHERE active = 1'
  );
  const [shops] = await conn.execute<(RowDataPacket & { id_shop: number })[]>(
    'SELECT id_shop FROM ps_shop WHERE active = 1'
  );

  // 1. Force a permissive carrier configuration: shipping_method=0 (price),
  //    range_behavior=1 (largest-range fallback), shipping_external=0 so PS
  //    doesn't try to call out to a module front-controller. Also set
  //    `position = id_carrier` so PS's "default carrier" resolution (which
  //    sorts by position ASC) is deterministic and matches our id ordering —
  //    keeps cart resolution from preferring an unrelated default over the
  //    `id_carrier` we explicitly send.
  await conn.execute(
    `UPDATE ps_carrier
     SET range_behavior = 1, shipping_method = 0, shipping_handling = 0,
         shipping_external = 0, is_module = 0, external_module_name = '',
         position = id_carrier
     WHERE id_carrier = ?`,
    [idCarrier]
  );

  // 2. Carrier-to-zone coverage for every active zone (idempotent).
  for (const zone of zones) {
    await conn.execute('INSERT IGNORE INTO ps_carrier_zone (id_carrier, id_zone) VALUES (?, ?)', [
      idCarrier,
      zone.id_zone,
    ]);
  }

  // 3. Wipe existing delivery + range rows so the new permissive ranges
  //    are the only ones in play. (PS's default narrow ranges otherwise
  //    win whenever the cart total falls inside them.)
  await conn.execute('DELETE FROM ps_delivery WHERE id_carrier = ?', [idCarrier]);
  await conn.execute('DELETE FROM ps_range_price WHERE id_carrier = ?', [idCarrier]);
  await conn.execute('DELETE FROM ps_range_weight WHERE id_carrier = ?', [idCarrier]);

  // 4. Seed fresh permissive ranges + delivery rows.
  await seedDeliveryRows(conn, idCarrier, zones, shops);
}

/**
 * Seed `ps_range_price`, `ps_range_weight`, and `ps_delivery` for a carrier
 * so PS treats the carrier as available + priced. Flat rate (12.50) covering
 * any cart 0–10000 in either price or weight.
 */
async function seedDeliveryRows(
  conn: Connection,
  idCarrier: number,
  zones: Array<{ id_zone: number }>,
  shops: Array<{ id_shop: number }>
): Promise<void> {
  const [priceRangeResult] = await conn.execute<ResultSetHeader>(
    `INSERT INTO ps_range_price (id_carrier, delimiter1, delimiter2)
     VALUES (?, 0.000000, 10000.000000)`,
    [idCarrier]
  );
  const [weightRangeResult] = await conn.execute<ResultSetHeader>(
    `INSERT INTO ps_range_weight (id_carrier, delimiter1, delimiter2)
     VALUES (?, 0.000000, 10000.000000)`,
    [idCarrier]
  );
  for (const zone of zones) {
    for (const shop of shops) {
      // Two ps_delivery rows per (carrier, zone, shop) — one keyed to the
      // price range, one to the weight range. Belt-and-braces: PS picks the
      // range row by the carrier's `shipping_method` (0=price, 1=weight); the
      // OL Dynamic seed uses 0, the secondary test carrier uses 0, but
      // production-default PS carriers typically use 1. Covering both keeps
      // the fixture insensitive to shipping_method drift.
      await conn.execute(
        `INSERT IGNORE INTO ps_delivery (id_carrier, id_range_price, id_range_weight, id_zone, id_shop, id_shop_group, price)
         VALUES (?, ?, 0, ?, ?, NULL, 12.50)`,
        [idCarrier, priceRangeResult.insertId, zone.id_zone, shop.id_shop]
      );
      await conn.execute(
        `INSERT IGNORE INTO ps_delivery (id_carrier, id_range_price, id_range_weight, id_zone, id_shop, id_shop_group, price)
         VALUES (?, 0, ?, ?, ?, NULL, 12.50)`,
        [idCarrier, weightRangeResult.insertId, zone.id_zone, shop.id_shop]
      );
    }
  }
}

export interface SeedPrestashopProductForOrdersOpts {
  /** PS reference / SKU. Used as the `ps_product.reference` value and for idempotency. */
  reference: string;
  /** Display name. Inserted into `ps_product_lang.name` for every active language. */
  name: string;
  /** Defaults to 100.00. PS stores `ps_product.price` as the pre-tax retail. */
  price?: number;
  /** Defaults to 50 — non-zero so the PS order-create's stock check passes. */
  stockQuantity?: number;
}

export interface SeededPrestashopProduct {
  /** PS `id_product` of the inserted row. */
  idProduct: number;
}

/**
 * Insert a minimal PS product (+ per-language / per-shop / stock rows) the
 * order-create path needs. Idempotent against `ps_product.reference`.
 *
 * Uses the same dynamic-INSERT machinery the WS API key + carrier seeds use
 * so PS column drift across versions surfaces with a precise diagnostic
 * instead of a generic "Field X has no default" error.
 */
export async function seedPrestashopProductForOrders(
  options: ApplyFixtureOptions,
  opts: SeedPrestashopProductForOrdersOpts
): Promise<SeededPrestashopProduct> {
  const conn = await createConnection({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    multipleStatements: false,
  });
  try {
    const existing = await conn.execute<(RowDataPacket & { id_product: number })[]>(
      'SELECT id_product FROM ps_product WHERE reference = ? LIMIT 1',
      [opts.reference]
    );
    const existingRows = existing[0];
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      return { idProduct: existingRows[0].id_product };
    }

    const price = opts.price ?? 100.0;
    const stockQuantity = opts.stockQuantity ?? 50;
    // PS schema marks `date_add` / `date_upd` as NOT NULL with no default,
    // so dynamicInsert needs explicit values. MySQL accepts the literal
    // 'YYYY-MM-DD HH:MM:SS' shape via prepared-statement binding.
    const nowMysql = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Minimum field set the PS order-create path needs to find a usable
    // product. Extra fields (weight, dimensions, SEO metadata, …) default
    // to harmless values in the schema and aren't required to land an order.
    const desiredProductColumns: Record<string, string | number> = {
      reference: opts.reference,
      price,
      wholesale_price: 0,
      active: 1,
      visibility: 'both',
      available_for_order: 1,
      show_price: 1,
      indexed: 1,
      state: 1,
      // Belongs to the default shop (1) and the default category (2 = home).
      id_shop_default: 1,
      id_category_default: 2,
      // Legacy fields — silently dropped on schema variants that no longer carry them.
      id_tax_rules_group: 0,
      id_manufacturer: 0,
      id_supplier: 0,
      ean13: '',
      upc: '',
      isbn: '',
      mpn: '',
      ecotax: 0,
      quantity: 0,
      minimal_quantity: 1,
      low_stock_threshold: 0,
      low_stock_alert: 0,
      additional_shipping_cost: 0,
      unit_price: 0,
      unity: '',
      additional_delivery_times: 1,
      customizable: 0,
      text_fields: 0,
      uploadable_files: 0,
      redirect_type: '404',
      id_type_redirected: 0,
      // MySQL 8.4 strict mode rejects '0000-00-00'; use a far-future placeholder
      // that signals "always available".
      available_date: '1970-01-01',
      on_sale: 0,
      online_only: 0,
      cache_is_pack: 0,
      cache_has_attachments: 0,
      is_virtual: 0,
      cache_default_attribute: 0,
      out_of_stock: 2,
      product_type: 'standard',
      pack_stock_type: 3,
      date_add: nowMysql,
      date_upd: nowMysql,
    };
    await assertNoUnsuppliedNotNullColumns(conn, 'ps_product', desiredProductColumns);
    const productInsert = await dynamicInsert(conn, 'ps_product', desiredProductColumns);
    const idProduct = productInsert.insertId;

    const [langRows] = await conn.execute<(RowDataPacket & { id_lang: number })[]>(
      'SELECT id_lang FROM ps_lang WHERE active = 1'
    );
    const [shopRows] = await conn.execute<(RowDataPacket & { id_shop: number })[]>(
      'SELECT id_shop FROM ps_shop WHERE active = 1'
    );

    const linkRewrite = opts.reference.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    for (const lang of langRows) {
      for (const shop of shopRows) {
        // ps_product_lang holds the public-facing product strings. Link rewrite
        // is required so PS doesn't 500 when generating a checkout URL even if
        // we never render the storefront. Use dynamicInsert so PS 9.x column
        // drift (e.g. removal of `meta_keywords`) doesn't break us.
        await upsertDynamicByColumnPresence(
          conn,
          'ps_product_lang',
          ['id_product', 'id_shop', 'id_lang'],
          {
            id_product: idProduct,
            id_shop: shop.id_shop,
            id_lang: lang.id_lang,
            name: opts.name,
            description: '',
            description_short: '',
            link_rewrite: linkRewrite,
            meta_title: opts.name,
            meta_description: '',
            meta_keywords: '',
            available_now: '',
            available_later: '',
            delivery_in_stock: '',
            delivery_out_stock: '',
          }
        );
      }
    }

    for (const shop of shopRows) {
      // ps_product_shop carries the per-shop product attributes that drive
      // pricing and availability. Without it, PS WS reports the product as
      // unavailable in this shop and the order-create fails on stock check.
      await upsertDynamicByColumnPresence(conn, 'ps_product_shop', ['id_product', 'id_shop'], {
        id_product: idProduct,
        id_shop: shop.id_shop,
        id_category_default: 2,
        id_tax_rules_group: 0,
        on_sale: 0,
        online_only: 0,
        ecotax: 0,
        minimal_quantity: 1,
        low_stock_threshold: 0,
        low_stock_alert: 0,
        price,
        wholesale_price: 0,
        unity: '',
        unit_price: 0,
        unit_price_ratio: 0,
        additional_shipping_cost: 0,
        customizable: 0,
        text_fields: 0,
        uploadable_files: 0,
        active: 1,
        redirect_type: '404',
        id_type_redirected: 0,
        available_for_order: 1,
        available_date: '1970-01-01',
        show_condition: 1,
        condition: 'new',
        show_price: 1,
        indexed: 1,
        visibility: 'both',
        cache_default_attribute: 0,
        advanced_stock_management: 0,
        date_add: nowMysql,
        date_upd: nowMysql,
        pack_stock_type: 3,
        product_type: 'standard',
      });
    }

    // ps_stock_available is what the order-create reads to verify the line.
    // We insert one row per shop. id_product_attribute=0 covers the
    // base-product case (no combinations) which is what this fixture supports.
    for (const shop of shopRows) {
      await conn.execute(
        `INSERT INTO ps_stock_available (id_product, id_product_attribute, id_shop, id_shop_group, quantity, physical_quantity, reserved_quantity, depends_on_stock, out_of_stock, location)
         VALUES (?, 0, ?, 0, ?, ?, 0, 0, 2, '')
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), physical_quantity = VALUES(physical_quantity)`,
        [idProduct, shop.id_shop, stockQuantity, stockQuantity]
      );
    }

    return { idProduct };
  } finally {
    await conn.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// OL Dynamic carrier — sidecar read (#692 / closes #513)
// ─────────────────────────────────────────────────────────────────────────

/**
 * A row from the OL module's per-cart shipping sidecar table.
 *
 * Mirrors `apps/prestashop-module/openlinker/openlinker.php::createCartShippingTable`.
 * `amount_tax_excl` / `amount_tax_incl` are MySQL `DECIMAL(20,6)` — mysql2
 * returns them as numeric strings by default; this type coerces at the boundary.
 */
export interface CartShippingRow {
  amountTaxExcl: number;
  amountTaxIncl: number;
  source: string | null;
}

/**
 * Read the `ps_openlinker_cart_shipping` row for the given cart id. Returns
 * `null` when no row exists. The S-3 carrier-mapping scenario uses this to
 * prove the adapter → cartshipping.php → CartShippingRepository::upsert
 * round-trip persisted the buyer-paid amount: a populated row is the unique
 * signal that the OL Dynamic carrier branch was taken (S-1 / S-2's static
 * carriers never write the sidecar).
 */
export async function readCartShipping(
  options: ApplyFixtureOptions,
  idCart: number,
): Promise<CartShippingRow | null> {
  const conn = await createConnection({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    multipleStatements: false,
  });
  try {
    const [rows] = await conn.execute<
      (RowDataPacket & {
        amount_tax_excl: string | number;
        amount_tax_incl: string | number;
        source: string | null;
      })[]
    >(
      `SELECT amount_tax_excl, amount_tax_incl, source
       FROM ps_openlinker_cart_shipping
       WHERE id_cart = ?
       LIMIT 1`,
      [idCart],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      amountTaxExcl: Number(row.amount_tax_excl),
      amountTaxIncl: Number(row.amount_tax_incl),
      source: row.source,
    };
  } finally {
    await conn.end();
  }
}
