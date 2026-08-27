<?php
/**
 * Replay rejection against real MySQL
 *
 * The guard's whole claim is an SQL one: one INSERT whose duplicate arm changes
 * nothing, so exactly one of two identical requests is told it is first. A unit
 * test cannot reach that (#2619).
 *
 * Skipped unless OPENLINKER_TEST_MYSQL_DSN is set, so the default suite stays
 * dependency-free. Run it against a throwaway server:
 *
 *   docker run -d --rm --name ol-nonce-mysql -e MYSQL_ROOT_PASSWORD=root \
 *     -e MYSQL_DATABASE=outbox -p 3399:3306 mysql:8.0
 *   OPENLINKER_TEST_MYSQL_DSN='mysql:host=127.0.0.1;port=3399;dbname=outbox' \
 *   OPENLINKER_TEST_MYSQL_USER=root OPENLINKER_TEST_MYSQL_PASSWORD=root \
 *     vendor/bin/phpunit --testsuite Integration
 */

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/prestashop-stubs.php';

final class ReplayGuardSqlTest extends TestCase
{
    private const TABLE = 'ps_openlinker_request_nonce';

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
        PrestaShopLogger::$logs = [];
        self::$pdo->exec('DROP TABLE IF EXISTS `' . self::TABLE . '`');
        self::$pdo->exec(
            'CREATE TABLE `' . self::TABLE . '` (
                `nonce` CHAR(64) NOT NULL,
                `created_at` DATETIME NOT NULL,
                PRIMARY KEY (`nonce`),
                KEY `created_at` (`created_at`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
    }

    public function testAFirstRequestIsAccepted(): void
    {
        self::assertTrue(ReplayGuard::claim('importorder', 'sha256=' . str_repeat('a', 64)));
        self::assertSame(1, $this->countRows());
    }

    public function testAByteIdenticalReplayIsRejected(): void
    {
        $signature = 'sha256=' . str_repeat('b', 64);

        self::assertTrue(ReplayGuard::claim('importorder', $signature));
        self::assertFalse(ReplayGuard::claim('importorder', $signature));
        // The replay added no row, so a third attempt cannot be let through by
        // the table having grown.
        self::assertFalse(ReplayGuard::claim('importorder', $signature));
        self::assertSame(1, $this->countRows());
    }

    public function testADifferentSignatureIsAccepted(): void
    {
        // A genuine retry re-signs with a fresh timestamp, so it must not read
        // as a replay.
        self::assertTrue(ReplayGuard::claim('importorder', 'sha256=' . str_repeat('c', 64)));
        self::assertTrue(ReplayGuard::claim('importorder', 'sha256=' . str_repeat('d', 64)));

        self::assertSame(2, $this->countRows());
    }

    public function testTheSameSignatureOnAnotherEndpointIsAccepted(): void
    {
        $signature = 'sha256=' . str_repeat('e', 64);

        self::assertTrue(ReplayGuard::claim('importorder', $signature));
        self::assertTrue(ReplayGuard::claim('cartshipping', $signature));
    }

    public function testTheStoredKeyIsNotTheSignature(): void
    {
        $signature = 'sha256=' . str_repeat('f', 64);
        ReplayGuard::claim('importorder', $signature);

        $stored = (string) self::$pdo
            ->query('SELECT `nonce` FROM `' . self::TABLE . '`')
            ->fetchColumn();

        self::assertNotSame($signature, $stored);
        self::assertSame(ReplayGuard::keyFor('importorder', $signature), $stored);
    }

    public function testKeysPastTheRetentionWindowArePruned(): void
    {
        self::$pdo->exec(
            'INSERT INTO `' . self::TABLE . '` (`nonce`, `created_at`)'
            . " VALUES ('" . str_repeat('0', 64) . "', DATE_SUB(NOW(), INTERVAL 1 DAY))"
        );

        ReplayGuard::claim('importorder', 'sha256=' . str_repeat('9', 64));

        // Only the fresh key survives.
        self::assertSame(1, $this->countRows());
    }

    public function testAnUnreachableTableLetsTheRequestThroughAndLogsIt(): void
    {
        // Refusing a real order because a housekeeping table is missing would be
        // worse than the replay window, but it must never be silent.
        self::$pdo->exec('DROP TABLE `' . self::TABLE . '`');

        self::assertTrue(ReplayGuard::claim('importorder', 'sha256=' . str_repeat('1', 64)));
        self::assertNotEmpty(PrestaShopLogger::$logs);
    }

    private function countRows(): int
    {
        return (int) self::$pdo
            ->query('SELECT COUNT(*) FROM `' . self::TABLE . '`')
            ->fetchColumn();
    }
}
