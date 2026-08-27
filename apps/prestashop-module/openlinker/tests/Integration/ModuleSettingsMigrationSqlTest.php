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

    public function testDoesNotTouchSettingsOwnedByPrestaShop(): void
    {
        $this->insert('PS_CARRIER_DEFAULT', '7', 1);

        ModuleSettings::migrateToGlobal();

        self::assertCount(1, $this->remainingRows('PS_CARRIER_DEFAULT'));
    }
}
