<?php
/**
 * Outbox coalescing against real MySQL
 *
 * Pins the part of #2603 that a unit test structurally cannot reach: the
 * coalescing rule is a unique index over a nullable column, and the fix is
 * about which statement releases that column. Both are SQL semantics.
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

final class OutboxDedupSqlTest extends TestCase
{
    private const CONNECTION_ID = 'conn-1';
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
        Configuration::set(['MAX_RETRY_ATTEMPTS' => 25, 'RETRY_BACKOFF_MULTIPLIER' => 2.0]);
        PrestaShopLogger::$logs = [];
        self::$pdo->exec('DROP TABLE IF EXISTS `' . self::TABLE . '`');
        self::$pdo->exec($this->createTableSql());
        $this->repository = new OutboxRepository();
    }

    // Coalescing while the row is queued

    public function testBurstOfIdenticalFiresCollapsesOntoOneQueuedRow(): void
    {
        for ($i = 0; $i < 6; $i++) {
            $this->enqueueProductSaved('23');
        }

        $this->assertSame(1, $this->countRows());
    }

    public function testCoalescedEnqueueReturnsTheQueuedRowId(): void
    {
        $first = $this->enqueueProductSaved('23');
        $second = $this->enqueueProductSaved('23');

        $this->assertGreaterThan(0, $first);
        $this->assertSame($first, $second);
    }

    // The bug: history must never block a new event

    public function testChangeAfterDeliveryGetsItsOwnRow(): void
    {
        $first = $this->enqueueProductSaved('23');
        $this->repository->markDelivered($first);

        $second = $this->enqueueProductSaved('23');

        $this->assertNotSame($first, $second);
        $this->assertSame(2, $this->countRows());
    }

    public function testChangeArrivingWhileTheRowIsBeingSentGetsItsOwnRow(): void
    {
        // The narrow window: claimed, HTTP POST in flight, markDelivered not yet
        // run. The claim releases the key, so this change is not swallowed.
        $first = $this->enqueueProductSaved('23');
        $claimed = $this->repository->claimBatchDueForDelivery(10, 'run-1');
        $this->assertCount(1, $claimed);

        $second = $this->enqueueProductSaved('23');
        $this->repository->markDelivered($first);

        $this->assertNotSame($first, $second);
        $this->assertSame(2, $this->countRows());
        $this->assertSame('pending', $this->statusOf($second));
    }

    public function testChangeAfterTerminalFailureGetsItsOwnRow(): void
    {
        $first = $this->enqueueProductSaved('23');
        $this->repository->markFailed($first, 'endpoint gone');

        $second = $this->enqueueProductSaved('23');

        $this->assertNotSame($first, $second);
        $this->assertSame(2, $this->countRows());
    }

    public function testRetryAfterAFailedDeliveryKeepsTheOriginalRow(): void
    {
        // A failed delivery is requeued, so the row is sent again under its own
        // event id. Nothing is lost; a duplicate pull is the accepted cost.
        $first = $this->enqueueProductSaved('23');
        $this->repository->claimBatchDueForDelivery(10, 'run-1');
        $this->repository->scheduleRetry($first, 0, 'connection refused');

        $this->assertSame('pending', $this->statusOf($first));
        $this->assertSame(1, $this->countRows());
    }

    // Discrimination

    public function testDistinctConnectionsDoNotCoalesce(): void
    {
        $a = $this->enqueueProductSaved('23', 'product.saved', 'product', 'conn-a');
        $b = $this->enqueueProductSaved('23', 'product.saved', 'product', 'conn-b');

        $this->assertNotSame($a, $b);
        $this->assertSame(2, $this->countRows());
    }

    public function testDistinctObjectTypesDoNotCoalesce(): void
    {
        $a = $this->enqueueProductSaved('23', 'product.saved', 'product');
        $b = $this->enqueueProductSaved('23', 'product.saved', 'stock');

        $this->assertNotSame($a, $b);
        $this->assertSame(2, $this->countRows());
    }

    public function testOptingOutOfCoalescingAlwaysInsertsARow(): void
    {
        // The admin test-connection probe passes dedupKey => null.
        $first = $this->enqueueProductSaved('23', 'product.saved', 'product', self::CONNECTION_ID, null);
        $second = $this->enqueueProductSaved('23', 'product.saved', 'product', self::CONNECTION_ID, null);

        $this->assertNotSame($first, $second);
        $this->assertSame(2, $this->countRows());
    }

    public function testEmptyStringDedupKeyIsTreatedAsAnOptOut(): void
    {
        // An empty string is not NULL-distinct, so one such row would block
        // every other subject in the table.
        $first = $this->enqueueProductSaved('23', 'product.saved', 'product', self::CONNECTION_ID, '');
        $second = $this->enqueueProductSaved('99', 'product.saved', 'product', self::CONNECTION_ID, '');

        $this->assertNotSame($first, $second);
        $this->assertSame(2, $this->countRows());
    }

    // Degradation when the upgrade never ran

    public function testEnqueueStillWorksWithoutTheDedupKeyColumn(): void
    {
        self::$pdo->exec('ALTER TABLE `' . self::TABLE . '` DROP INDEX `dedup_key`');
        self::$pdo->exec('ALTER TABLE `' . self::TABLE . '` DROP COLUMN `dedup_key`');

        $repository = new OutboxRepository();
        $first = $repository->enqueueEvent($this->eventData('23'));
        $second = $repository->enqueueEvent($this->eventData('23'));

        $this->assertGreaterThan(0, $first);
        $this->assertNotSame($first, $second);
        $this->assertNotEmpty(PrestaShopLogger::$logs);
    }

    // Helpers

    private function enqueueProductSaved(
        string $externalId,
        string $eventType = 'product.saved',
        string $objectType = 'product',
        string $connectionId = self::CONNECTION_ID,
        $dedupKey = false
    ): int {
        $data = $this->eventData($externalId, $eventType, $objectType, $connectionId);
        if ($dedupKey !== false) {
            $data['dedupKey'] = $dedupKey;
        }

        return $this->repository->enqueueEvent($data);
    }

    private function eventData(
        string $externalId,
        string $eventType = 'product.saved',
        string $objectType = 'product',
        string $connectionId = self::CONNECTION_ID
    ): array {
        return [
            'connectionId' => $connectionId,
            'eventType' => $eventType,
            'objectType' => $objectType,
            'externalId' => $externalId,
            'payloadJson' => null,
        ];
    }

    private function countRows(): int
    {
        return (int)self::$pdo->query('SELECT COUNT(*) FROM `' . self::TABLE . '`')->fetchColumn();
    }

    private function statusOf(int $id): string
    {
        $statement = self::$pdo->prepare('SELECT `status` FROM `' . self::TABLE . '` WHERE `id` = ?');
        $statement->execute([$id]);

        return (string)$statement->fetchColumn();
    }

    private function createTableSql(): string
    {
        // Kept byte-identical in shape to OpenLinker::createOutboxTable() so the
        // index semantics under test are the ones the module actually installs.
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
            KEY `processing_owner_started` (`processing_owner`, `processing_started_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    }
}
