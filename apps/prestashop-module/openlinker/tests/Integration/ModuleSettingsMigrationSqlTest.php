<?php
/**
 * Module-setting scope migration against real MySQL
 *
 * Pins what a unit test cannot: that after the migration a value written in one
 * shop context is readable from another, because the shop-scoped rows that used
 * to shadow the global one are gone (#2602).
 *
 * Skipped unless OPENLINKER_TEST_MYSQL_DSN is set - see
 * tests/Integration/OutboxRetentionSqlTest.php for how to start a server.
 */

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/prestashop-stubs.php';

final class ModuleSettingsMigrationSqlTest extends TestCase
{
    private const TABLE = 'ps_configuration';

    /** @var PDO */
    private static $pdo;

    public static function setUpBeforeClass(): void
    {
        $dsn = getenv('OPENLINKER_TEST_MYSQL_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('OPENLINKER_TEST_MYSQL_DSN is not set');
        }

        self::$pdo = new PDO(
            $dsn,
            getenv('OPENLINKER_TEST_MYSQL_USER') ?: 'root',
            getenv('OPENLINKER_TEST_MYSQL_PASSWORD') ?: 'root',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        Db::boot(self::$pdo);
    }

    protected function setUp(): void
    {
        Configuration::set([]);
        Configuration::$globalValues = [];
        PrestaShopLogger::$logs = [];
        self::$pdo->exec('DROP TABLE IF EXISTS `' . self::TABLE . '`');
        self::$pdo->exec(
            'CREATE TABLE `' . self::TABLE . '` ('
            . ' `id_configuration` INT AUTO_INCREMENT PRIMARY KEY,'
            . ' `id_shop_group` INT NULL,'
            . ' `id_shop` INT NULL,'
            . ' `name` VARCHAR(254) NOT NULL,'
            . ' `value` TEXT NULL'
            . ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
        );
    }

    private function insert($name, $value, $idShop, $idShopGroup = null)
    {
        $statement = self::$pdo->prepare(
            'INSERT INTO `' . self::TABLE . '` (`id_shop_group`, `id_shop`, `name`, `value`)'
            . ' VALUES (?, ?, ?, ?)'
        );
        $statement->execute([$idShopGroup, $idShop, $name, $value]);
    }

    private function remainingRows($name)
    {
        $statement = self::$pdo->prepare(
            'SELECT `id_shop`, `id_shop_group`, `value` FROM `' . self::TABLE . '` WHERE `name` = ?'
        );
        $statement->execute([$name]);

        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    public function testPromotesAPerShopSecretAndRemovesTheShadowingRows(): void
    {
        $this->insert('OPENLINKER_WEBHOOK_SECRET', 'shared-secret', 1);
        $this->insert('OPENLINKER_WEBHOOK_SECRET', '', 2);

        ModuleSettings::migrateToGlobal();

        self::assertSame('shared-secret', Configuration::$globalValues['OPENLINKER_WEBHOOK_SECRET']);
        self::assertSame([], $this->remainingRows('OPENLINKER_WEBHOOK_SECRET'));
    }

    /**
     * A global row that already holds a value wins over a shop-scoped one.
     *
     * The shape is ordinary: configured under shop 1, later re-configured under
     * "All shops", so the OLD secret is shop-scoped and the CURRENT one global.
     * Promoting the shop-scoped row and deleting the source replaced a working
     * secret with a stale one and every inbound request answered 401, with
     * `logConflictingValues` silent because there was only one distinct
     * shop-scoped value (#2627 review).
     */
    public function testKeepsAnExistingGlobalValueOverAShopScopedOne(): void
    {
        $this->insert('OPENLINKER_WEBHOOK_SECRET', 'current-secret', null, null);
        $this->insert('OPENLINKER_WEBHOOK_SECRET', 'stale-secret', 1);

        ModuleSettings::migrateToGlobal();

        self::assertArrayNotHasKey('OPENLINKER_WEBHOOK_SECRET', Configuration::$globalValues);

        // The shadowing shop-scoped row still goes: `Configuration::get` prefers
        // it over the global one, so leaving it would keep hiding the value in
        // use.
        $remaining = $this->remainingRows('OPENLINKER_WEBHOOK_SECRET');
        self::assertCount(1, $remaining);
        self::assertSame('current-secret', $remaining[0]['value']);
    }

    /**
     * An all-empty shop-scoped set writes nothing at all.
     *
     * `pickValueToPromote` answers `null` there, and the caller's guard is what
     * stops an empty string being written globally - after which
     * `HmacRequestVerifier::verify` answers `misconfigured` on every request.
     */
    public function testWritesNothingWhenEveryShopScopedRowIsEmpty(): void
    {
        $this->insert('OPENLINKER_WEBHOOK_SECRET', '', 1);
        $this->insert('OPENLINKER_WEBHOOK_SECRET', '', 2);

        ModuleSettings::migrateToGlobal();

        self::assertArrayNotHasKey('OPENLINKER_WEBHOOK_SECRET', Configuration::$globalValues);
    }

    public function testPromotesAShopGroupScopedRow(): void
    {
        $this->insert('OPENLINKER_CONNECTION_ID', 'conn-1', null, 3);

        ModuleSettings::migrateToGlobal();

        self::assertSame('conn-1', Configuration::$globalValues['OPENLINKER_CONNECTION_ID']);
        self::assertSame([], $this->remainingRows('OPENLINKER_CONNECTION_ID'));
    }

    public function testLeavesAnAlreadyGlobalRowAlone(): void
    {
        $this->insert('OPENLINKER_CRON_TOKEN', 'token-global', null, null);

        ModuleSettings::migrateToGlobal();

        self::assertArrayNotHasKey('OPENLINKER_CRON_TOKEN', Configuration::$globalValues);
        self::assertCount(1, $this->remainingRows('OPENLINKER_CRON_TOKEN'));
    }

    /**
     * The destructive case the corrected predicate exists for.
     *
     * PrestaShop core treats `id_shop = 0` as global. The old predicate read
     * such a row as shop-scoped, so `updateGlobalValue` wrote into that same
     * row and the following DELETE removed it - the signing secret ended up in
     * no row at all, with nothing left to recover it from.
     */
    public function testLeavesAGlobalRowStoredAsShopZeroAlone(): void
    {
        $this->insert('OPENLINKER_WEBHOOK_SECRET', 'legacy-global-secret', 0, 0);

        ModuleSettings::migrateToGlobal();

        $rows = $this->remainingRows('OPENLINKER_WEBHOOK_SECRET');
        self::assertCount(1, $rows, 'the legacy global row was deleted');
        self::assertSame('legacy-global-secret', $rows[0]['value']);
    }

    public function testPromotesPerShopRowsWithoutDestroyingAShopZeroGlobalRow(): void
    {
        $this->insert('OPENLINKER_CRON_TOKEN', 'legacy-global', 0, 0);
        $this->insert('OPENLINKER_CRON_TOKEN', 'per-shop', 2);

        ModuleSettings::migrateToGlobal();

        self::assertSame('per-shop', Configuration::$globalValues['OPENLINKER_CRON_TOKEN']);
        $rows = $this->remainingRows('OPENLINKER_CRON_TOKEN');
        self::assertCount(1, $rows);
        self::assertSame('legacy-global', $rows[0]['value']);
    }

    /**
     * A second run must be a no-op, so an operator can re-run the upgrade after
     * the fix without risking the value the first run settled.
     */
    public function testIsANoOpOnASecondRun(): void
    {
        $this->insert('OPENLINKER_WEBHOOK_SECRET', 'shared-secret', 1);

        ModuleSettings::migrateToGlobal();
        Configuration::$globalValues = [];
        ModuleSettings::migrateToGlobal();

        self::assertSame([], Configuration::$globalValues, 'the second run wrote something');
        self::assertSame([], $this->remainingRows('OPENLINKER_WEBHOOK_SECRET'));
    }

    public function testLogsWhenShopsHeldDifferentValues(): void
    {
        $this->insert('OPENLINKER_WEBHOOK_SECRET', 'secret-a', 1);
        $this->insert('OPENLINKER_WEBHOOK_SECRET', 'secret-b', 2);

        ModuleSettings::migrateToGlobal();

        self::assertCount(1, PrestaShopLogger::$logs);
        self::assertStringContainsString(
            'OPENLINKER_WEBHOOK_SECRET',
            PrestaShopLogger::$logs[0]['message']
        );
        // The values themselves must never reach the log - one of these keys is
        // a signing secret.
        self::assertStringNotContainsString('secret-a', PrestaShopLogger::$logs[0]['message']);
        self::assertStringNotContainsString('secret-b', PrestaShopLogger::$logs[0]['message']);
    }

    public function testDoesNotLogWhenEveryShopAgreed(): void
    {
        $this->insert('OPENLINKER_CONNECTION_ID', 'conn-1', 1);
        $this->insert('OPENLINKER_CONNECTION_ID', 'conn-1', 2);

        ModuleSettings::migrateToGlobal();

        self::assertSame([], PrestaShopLogger::$logs);
    }

    public function testDoesNotTouchSettingsOwnedByPrestaShop(): void
    {
        $this->insert('PS_CARRIER_DEFAULT', '7', 1);

        ModuleSettings::migrateToGlobal();

        self::assertCount(1, $this->remainingRows('PS_CARRIER_DEFAULT'));
    }
}
