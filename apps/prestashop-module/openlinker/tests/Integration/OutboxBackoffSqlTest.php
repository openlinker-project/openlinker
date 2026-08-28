<?php
/**
 * Endpoint-level backoff and recovery against real MySQL (#2614)
 *
 * The pure delay maths is unit-tested. What needs a database is the state
 * around it: that a failing run raises the endpoint streak once rather than
 * once per row, that a success clears it and pulls the whole backlog forward,
 * and - the property that matters most - that no row is ever dropped or made
 * undeliverable on the way.
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

final class OutboxBackoffSqlTest extends TestCase
{
    private const TABLE = 'ps_openlinker_webhook_outbox';
    private const STREAK_KEY = OutboxRepository::ENDPOINT_FAILURE_STREAK_CONFIG_KEY;

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

    // The streak

    public function testOneFailingRunCountsOnceHoweverManyRowsItFailedOn(): void
    {
        $rows = [$this->insertPending(), $this->insertPending(), $this->insertPending()];

        foreach ($rows as $id) {
            $this->repository->scheduleRetry($id, 0, 'endpoint down');
        }

        $this->assertSame(1, (int)Configuration::get(self::STREAK_KEY));
    }

    public function testTheStreakGrowsAcrossRuns(): void
    {
        for ($run = 1; $run <= 3; $run++) {
            $repository = new OutboxRepository();
            $repository->scheduleRetry($this->insertPending(), 0, 'endpoint down');
            $this->assertSame($run, (int)Configuration::get(self::STREAK_KEY));
        }
    }

    public function testAFreshRowWaitsLongerOnceTheEndpointHasBeenDownAWhile(): void
    {
        Configuration::updateValue(self::STREAK_KEY, 8);

        $id = $this->insertPending();
        $this->repository->scheduleRetry($id, 0, 'endpoint down');

        // The row's own first attempt would be a minute. The endpoint's history
        // is what makes it wait.
        $this->assertGreaterThan(60, $this->secondsUntilNextAttempt($id));
    }

    public function testAFailedRowIsNotEvidenceAboutTheEndpoint(): void
    {
        // One row exhausting its own attempts must not raise the delay floor
        // for every healthy row.
        $this->repository->markFailed($this->insertPending(), 'gave up');

        $this->assertSame(0, (int)Configuration::get(self::STREAK_KEY));
    }

    public function testADiagnosticProbeDoesNotRaiseTheEndpointFloor(): void
    {
        $this->repository->scheduleRetry($this->insertPending(), 0, 'test ping failed', false);

        $this->assertSame(0, (int)Configuration::get(self::STREAK_KEY));
    }

    // Recovery

    public function testASuccessClearsTheStreakAndPullsTheBacklogForward(): void
    {
        Configuration::updateValue(self::STREAK_KEY, 9);
        $waiting = [$this->insertPending(3600), $this->insertPending(7200)];
        $delivered = $this->insertPending();

        $this->repository->markDelivered($delivered);

        $this->assertSame(0, (int)Configuration::get(self::STREAK_KEY));
        foreach ($waiting as $id) {
            $this->assertNull($this->nextAttemptAt($id), 'a waiting row was left on its outage delay');
            $this->assertSame('pending', $this->statusOf($id));
        }
    }

    public function testAMixedPassLeavesAFailingRowOnItsOwnBackoff(): void
    {
        // The B1 regression. One row keeps failing on its own history while
        // another row on the same endpoint delivers. The failing row's wait is
        // its own, so recovery must not pull it forward.
        $failing = $this->insertPending();
        self::$pdo->exec('UPDATE `' . self::TABLE . '` SET `attempts` = 9 WHERE `id` = ' . $failing);

        $this->repository->scheduleRetry($failing, 9, 'transient 500 on this row');
        $waitBefore = $this->secondsUntilNextAttempt($failing);
        $this->assertGreaterThan(OutboxRepository::ENDPOINT_MAX_DELAY_SECONDS, $waitBefore);

        $this->repository->markDelivered($this->insertPending());

        $this->assertNotNull(
            $this->nextAttemptAt($failing),
            'a row waiting on its own repeated failure lost its backoff'
        );
        $this->assertGreaterThan(
            OutboxRepository::ENDPOINT_MAX_DELAY_SECONDS,
            $this->secondsUntilNextAttempt($failing)
        );
    }

    public function testAMixedPassStillReleasesTheOutageBacklog(): void
    {
        // The other half: a row that has barely failed is waiting on the
        // endpoint, so it must come straight back.
        Configuration::updateValue(self::STREAK_KEY, 9);
        $queued = $this->insertPending(3600);

        $this->repository->markDelivered($this->insertPending());

        $this->assertNull($this->nextAttemptAt($queued));
    }

    public function testAFailingRowCannotBeTerminalisedByRepeatedRecoveries(): void
    {
        // The consequence B1 described: with the wait destroyed on every pass
        // the row was eligible again each minute and reached `failed` in about
        // as many cron passes as its attempt ceiling.
        Configuration::updateValue('MAX_RETRY_ATTEMPTS', 12);
        $failing = $this->insertPending();

        for ($pass = 0; $pass < 12; $pass++) {
            $attempts = (int)$this->rowOf($failing)['attempts'];
            if ($this->statusOf($failing) !== 'pending' || $this->secondsUntilNextAttempt($failing) > 0) {
                break;
            }

            $repository = new OutboxRepository();
            $repository->scheduleRetry($failing, $attempts, 'still failing');
            $repository->markDelivered($this->insertPending());
        }

        $this->assertSame('pending', $this->statusOf($failing));
        $this->assertLessThan(12, (int)$this->rowOf($failing)['attempts']);
    }

    public function testRecoveryDoesNotDisturbRowsThatAreNotWaiting(): void
    {
        Configuration::updateValue(self::STREAK_KEY, 5);
        $leased = $this->insertPending();
        self::$pdo->exec('UPDATE `' . self::TABLE . '` SET `status` = "processing" WHERE `id` = ' . $leased);

        $this->repository->markDelivered($this->insertPending());

        $this->assertSame('processing', $this->statusOf($leased));
    }

    public function testAFailureAfterARecoveryInTheSameRunCountsAgain(): void
    {
        Configuration::updateValue(self::STREAK_KEY, 4);

        $this->repository->markDelivered($this->insertPending());
        $this->repository->scheduleRetry($this->insertPending(), 0, 'went down again');

        $this->assertSame(1, (int)Configuration::get(self::STREAK_KEY));
    }

    // The safety property

    public function testNoRowIsLostOrTerminalisedEarlyByTheEndpointBackoff(): void
    {
        Configuration::updateValue(self::STREAK_KEY, OutboxRepository::ENDPOINT_FAILURE_STREAK_MAX);
        $id = $this->insertPending();

        $this->repository->scheduleRetry($id, 0, 'endpoint down');

        $this->assertSame('pending', $this->statusOf($id), 'a retryable row was terminalised');
        $this->assertSame(1, (int)$this->rowOf($id)['attempts']);
        $this->assertLessThanOrEqual(
            OutboxRepository::RETRY_MAX_DELAY_SECONDS,
            $this->secondsUntilNextAttempt($id)
        );
    }

    public function testARowStillReachesFailedAtTheAttemptCeiling(): void
    {
        // The streak must not become a way for a bad row to retry forever.
        Configuration::updateValue('MAX_RETRY_ATTEMPTS', 3);
        $id = $this->insertPending();

        $this->repository->scheduleRetry($id, 3, 'bad payload');

        $this->assertSame('failed', $this->statusOf($id));
    }

    // Helpers

    private function insertPending(?int $nextAttemptInSeconds = null): int
    {
        static $seq = 0;
        $seq++;

        $nextAttempt = $nextAttemptInSeconds === null
            ? 'NULL'
            : '"' . date('Y-m-d H:i:s', time() + $nextAttemptInSeconds) . '"';

        self::$pdo->exec('INSERT INTO `' . self::TABLE . '` (
            `event_id`, `connection_id`, `event_type`, `object_type`, `external_id`,
            `occurred_at`, `status`, `attempts`, `next_attempt_at`, `created_at`, `updated_at`
        ) VALUES (
            "evt-' . $seq . '", "conn", "product.updated", "product", "' . $seq . '",
            NOW(), "pending", 0, ' . $nextAttempt . ', NOW(), NOW()
        )');

        return (int)self::$pdo->lastInsertId();
    }

    private function rowOf(int $id): array
    {
        $statement = self::$pdo->query('SELECT * FROM `' . self::TABLE . '` WHERE `id` = ' . $id);

        return $statement->fetch(PDO::FETCH_ASSOC);
    }

    private function statusOf(int $id): string
    {
        return (string)$this->rowOf($id)['status'];
    }

    private function nextAttemptAt(int $id): ?string
    {
        return $this->rowOf($id)['next_attempt_at'];
    }

    private function secondsUntilNextAttempt(int $id): int
    {
        return strtotime((string)$this->nextAttemptAt($id)) - time();
    }

    private function createTableSql(): string
    {
        // Kept in the shape OpenLinker::createOutboxTable() installs, plus the
        // (status, updated_at) index upgrade-1.4.0.php adds.
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
