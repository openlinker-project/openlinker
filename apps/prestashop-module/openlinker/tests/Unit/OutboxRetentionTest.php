<?php

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the pure half of outbox retention (#2604).
 *
 * The DELETE statements themselves are exercised against a real MySQL 8 - see
 * docs/prestashop-module-testing-guide.md. What is testable without a database
 * is the interval gate and the horizon coercion, and both have a wrong answer
 * that silently deletes an operator's history.
 *
 * @see OutboxRepository
 */
class OutboxRetentionTest extends TestCase
{
    private const NOW = 1700000000;

    public function testRunsWhenItNeverRanBefore(): void
    {
        $this->assertTrue(OutboxRepository::shouldRunRetention(0, self::NOW));
    }

    public function testDoesNotRunAgainWithinTheInterval(): void
    {
        $lastRun = self::NOW - (OutboxRepository::RETENTION_MIN_INTERVAL_SECONDS - 1);

        $this->assertFalse(OutboxRepository::shouldRunRetention($lastRun, self::NOW));
    }

    public function testRunsOnceTheIntervalHasElapsed(): void
    {
        $lastRun = self::NOW - OutboxRepository::RETENTION_MIN_INTERVAL_SECONDS;

        $this->assertTrue(OutboxRepository::shouldRunRetention($lastRun, self::NOW));
    }

    public function testForceBypassesTheInterval(): void
    {
        $this->assertTrue(OutboxRepository::shouldRunRetention(self::NOW, self::NOW, true));
    }

    public function testRunsWhenTheStampedRunIsInTheFuture(): void
    {
        // A clock that jumped backwards must not park retention until the
        // stamped future catches up, which could be years.
        $this->assertTrue(OutboxRepository::shouldRunRetention(self::NOW + 86400, self::NOW));
    }

    public function testHorizonFallsBackToTheDefaultWhenUnset(): void
    {
        $this->assertSame(
            OutboxRepository::DEFAULT_RETENTION_DELIVERED_DAYS,
            OutboxRepository::resolveRetentionDeliveredDays(false)
        );
    }

    /**
     * @dataProvider unusableHorizonProvider
     * @param mixed $raw
     */
    public function testUnusableHorizonNeverMeansDeleteImmediately($raw): void
    {
        $this->assertSame(
            OutboxRepository::DEFAULT_RETENTION_DELIVERED_DAYS,
            OutboxRepository::resolveRetentionDeliveredDays($raw)
        );
    }

    public static function unusableHorizonProvider(): array
    {
        return [
            'empty string' => [''],
            'zero' => ['0'],
            'negative' => ['-5'],
            'not a number' => ['later'],
            'null' => [null],
        ];
    }

    public function testHorizonIsClampedToTheMaximum(): void
    {
        $this->assertSame(
            OutboxRepository::RETENTION_DELIVERED_DAYS_MAX,
            OutboxRepository::resolveRetentionDeliveredDays('9999')
        );
    }

    public function testValidHorizonIsHonoured(): void
    {
        $this->assertSame(14, OutboxRepository::resolveRetentionDeliveredDays('14'));
    }

    public function testFailedRowsAreKeptLongerThanDeliveredOnes(): void
    {
        // Failed rows are the only record of what broke, so no configuration of
        // the delivered horizon may make them the first thing pruned.
        $this->assertGreaterThan(
            OutboxRepository::DEFAULT_RETENTION_DELIVERED_DAYS,
            OutboxRepository::RETENTION_FAILED_DAYS
        );
    }

    public function testEveryPassIsBounded(): void
    {
        $this->assertGreaterThan(0, OutboxRepository::RETENTION_DELETE_BATCH_SIZE);
        $this->assertGreaterThan(0, OutboxRepository::RETENTION_MAX_BATCHES_PER_PASS);
        $this->assertLessThanOrEqual(
            OutboxRepository::RETENTION_MAX_ROWS,
            OutboxRepository::RETENTION_DELETE_BATCH_SIZE * OutboxRepository::RETENTION_MAX_BATCHES_PER_PASS
        );
    }
}
