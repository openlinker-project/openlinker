<?php
/**
 * Outbox retention against real MySQL
 *
 * Pins the part of #2604 a unit test structurally cannot reach: what the
 * retention DELETEs actually remove from a table that holds live work beside
 * history. The one property that has to hold is that no retention statement can
 * touch a `pending` or `processing` row - either would lose an event, which is
 * the failure the outbox exists to prevent.
 *
 * Skipped unless OPENLINKER_TEST_MYSQL_DSN is set, so the default suite stays
 * dependency-free. Run it against a throwaway server:
 *
 *   docker run -d --rm --name ol-outbox-mysql -e MYSQL_ROOT_PASSWORD=root \
 *     -e MYSQL_DATABASE=outbox -p 3399:3306 mysql:8.0
 *   OPENLINKER_TEST_MYSQL_DSN='mysql:host=127.0.0.1;port=3399;dbname=outbox' \
 *   OPENLINKER_TEST_MYSQL_USER=root OPENLINKER_TEST_MYSQL_PASSWORD=root \
 *     vendor/bin/phpunit --testsuite Integration
 */

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/prestashop-stubs.php';

final class OutboxRetentionSqlTest extends TestCase
{
    private const TABLE = 'ps_openlinker_webhook_outbox';

    /** @var PDO */
    private static $pdo;

    /** @var OutboxRepository */
    private $repository;

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
        PrestaShopLogger::$logs = [];
        self::$pdo->exec('DROP TABLE IF EXISTS `' . self::TABLE . '`');
        self::$pdo->exec($this->createTableSql());
        $this->repository = new OutboxRepository();
    }

    // The safety property

    public function testRetentionNeverDeletesAQueuedOrLeasedRowHoweverOldItIs(): void
    {
        $pending = $this->insertRow('pending', 400);
        $processing = $this->insertRow('processing', 400);
        $delivered = $this->insertRow('delivered', 400);
        $failed = $this->insertRow('failed', 400);

        $report = $this->repository->runRetention(true);

        $this->assertTrue($this->rowExists($pending), 'a pending row was deleted');
        $this->assertTrue($this->rowExists($processing), 'a processing row was deleted');
        $this->assertFalse($this->rowExists($delivered));
        $this->assertFalse($this->rowExists($failed));
        $this->assertSame(1, $report['deleted_delivered']);
        $this->assertSame(1, $report['deleted_failed']);
    }

    public function testEveryStatusIsRepresentedByTheEnumUnderTest(): void
    {
        // If a fifth status is ever added, retention's two-value whitelist has
        // to be revisited, and this is where that shows up.
        $this->assertSame(
            ['pending', 'processing', 'delivered', 'failed'],
            $this->statusEnumValues()
        );
    }

    // The horizons

    public function testARowInsideItsHorizonSurvives(): void
    {
        $recentDelivered = $this->insertRow('delivered', 1);
        $recentFailed = $this->insertRow('failed', 10);

        $this->repository->runRetention(true);

        $this->assertTrue($this->rowExists($recentDelivered));
        $this->assertTrue($this->rowExists($recentFailed));
    }

    public function testAFailedRowOutlivesADeliveredRowOfTheSameAge(): void
    {
        // Failed rows are the only record of what broke, so at any age between
        // the two horizons the delivered row goes and the failed row stays.
        $delivered = $this->insertRow('delivered', 20);
        $failed = $this->insertRow('failed', 20);

        $this->repository->runRetention(true);

        $this->assertFalse($this->rowExists($delivered));
        $this->assertTrue($this->rowExists($failed));
    }

    public function testTheOldestRowsGoFirst(): void
    {
        $this->insertRow('delivered', 90);
        $this->insertRow('delivered', 80);
        $keptId = $this->insertRow('delivered', 1);

        $this->repository->runRetention(true);

        $this->assertSame([$keptId], $this->allIds());
    }

    // Reporting

    public function testAnOperatorForcedPassIgnoresTheIntervalGate(): void
    {
        $this->insertRow('delivered', 90);
        $this->repository->runRetention(true);

        $second = $this->repository->runRetention();
        $this->assertFalse($second['ran'], 'the interval gate did not hold');

        $third = $this->repository->runRetention(true);
        $this->assertTrue($third['ran']);
    }

    public function testAPassThatDidNotSpendItsBudgetDoesNotAskForAnotherTick(): void
    {
        $this->insertRow('delivered', 90);

        $report = $this->repository->runRetention(true);

        $this->assertFalse($report['drain_pending']);
    }

    public function testTheRowCountStopsAtItsProbeBound(): void
    {
        $this->insertRows('delivered', 1, 5);

        $this->assertSame(3, $this->repository->countRowsUpTo(3));
        $this->assertSame(5, $this->repository->countRowsUpTo(500));
    }

    public function testAnUnderCapTableIsNeverReportedAsABacklog(): void
    {
        $this->insertRow('pending', 400);

        $report = $this->repository->runRetention(true);

        $this->assertFalse($report['backlog_over_cap']);
        $this->assertFalse($report['rows_capped']);
    }

    // Helpers

    private function insertRow(string $status, int $ageDays): int
    {
        return $this->insertRows($status, $ageDays, 1)[0];
    }

    /**
     * @return int[] Inserted ids
     */
    private function insertRows(string $status, int $ageDays, int $count): array
    {
        $ids = [];
        // The interval is interpolated, not bound: MySQL will not take a
        // placeholder inside an INTERVAL expression.
        $statement = self::$pdo->prepare(
            'INSERT INTO `' . self::TABLE . '`
             (`event_id`, `connection_id`, `event_type`, `object_type`, `external_id`,
              `occurred_at`, `status`, `created_at`, `updated_at`)
             VALUES (?, "conn-1", "product.saved", "product", "1",
                     NOW(), ?, NOW(), DATE_SUB(NOW(), INTERVAL ' . (int)$ageDays . ' DAY))'
        );

        for ($i = 0; $i < $count; $i++) {
            $statement->execute([uniqid('evt-', true), $status]);
            $ids[] = (int)self::$pdo->lastInsertId();
        }

        return $ids;
    }

    private function rowExists(int $id): bool
    {
        $statement = self::$pdo->prepare('SELECT COUNT(*) FROM `' . self::TABLE . '` WHERE `id` = ?');
        $statement->execute([$id]);

        return (int)$statement->fetchColumn() === 1;
    }

    /**
     * @return int[]
     */
    private function allIds(): array
    {
        return array_map(
            'intval',
            self::$pdo->query('SELECT `id` FROM `' . self::TABLE . '` ORDER BY `id`')
                ->fetchAll(PDO::FETCH_COLUMN)
        );
    }

    /**
     * @return string[]
     */
    private function statusEnumValues(): array
    {
        $row = self::$pdo->query(
            'SHOW COLUMNS FROM `' . self::TABLE . '` LIKE \'status\''
        )->fetch(PDO::FETCH_ASSOC);

        preg_match_all("/'([^']+)'/", (string)$row['Type'], $matches);

        return $matches[1];
    }

    private function createTableSql(): string
    {
        // Kept in the shape OpenLinker::createOutboxTable() installs, plus the
        // (status, updated_at) index upgrade-1.4.0.php adds, so the statements
        // under test read the index they read in production.
        return 'CREATE TABLE `' . self::TABLE . '` (
            `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
            `event_id` VARCHAR(255) NOT NULL,
            `dedup_key` VARCHAR(255) NULL,
            `schema_version` INT(11) NOT NULL DEFAULT 1,
            `provider` VARCHAR(50) NOT NULL DEFAULT "prestashop",
            `connection_id` VARCHAR(255) NOT NULL,
            `event_type` VARCHAR(100) NOT NULL,
            `object_type` VARCHAR(50) NOT NULL,
            `external_id` VARCHAR(255) NOT NULL,
            `occurred_at` DATETIME NOT NULL,
            `payload_json` TEXT NULL,
            `status` ENUM("pending", "processing", "delivered", "failed") NOT NULL DEFAULT "pending",
            `attempts` INT(11) NOT NULL DEFAULT 0,
            `next_attempt_at` DATETIME NULL,
            `last_error` TEXT NULL,
            `processing_owner` VARCHAR(64) NULL,
            `processing_started_at` DATETIME NULL,
            `created_at` DATETIME NOT NULL,
            `updated_at` DATETIME NOT NULL,
            `delivered_at` DATETIME NULL,
            PRIMARY KEY (`id`),
            UNIQUE KEY `event_id` (`event_id`),
            UNIQUE KEY `dedup_key` (`dedup_key`),
            KEY `status_next_attempt_created` (`status`, `next_attempt_at`, `created_at`),
            KEY `status_updated` (`status`, `updated_at`),
            KEY `processing_owner_started` (`processing_owner`, `processing_started_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    }
}
