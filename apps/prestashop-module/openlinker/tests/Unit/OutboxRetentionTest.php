<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/ps-sql-functions.php';

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

    // The one property that must never break: a retention DELETE can only ever
    // name a terminal status. `pending` is queued work and `processing` is
    // leased by a live cron run, so either being reachable would lose an event.

    /**
     * @dataProvider terminalStatusProvider
     */
    public function testABuiltDeleteNamesOnlyTheTerminalStatusItWasAskedFor(string $status): void
    {
        $sql = OutboxRepository::buildTerminalDeleteSql('ps_outbox', $status, 7, 1000);

        $this->assertStringContainsString('`status` = "' . $status . '"', $sql);
        $this->assertStringNotContainsString('pending', $sql);
        $this->assertStringNotContainsString('processing', $sql);
    }

    public function testABuiltDeleteHasNoStatusPredicateOtherThanEquality(): void
    {
        $sql = OutboxRepository::buildTerminalDeleteSql('ps_outbox', 'delivered', null, 1000);

        // One status predicate, and it is an equality against one literal. An
        // `IN (...)` or a negation would be the shape that lets a live row in.
        $this->assertSame(1, substr_count($sql, '`status`'));
        $this->assertStringNotContainsString('IN (', $sql);
        $this->assertStringNotContainsString('!=', $sql);
        $this->assertStringNotContainsString('<>', $sql);
        $this->assertStringNotContainsString('NOT', $sql);
    }

    /**
     * @dataProvider nonTerminalStatusProvider
     * @param mixed $status
     */
    public function testANonTerminalStatusCannotBuildADeleteAtAll($status): void
    {
        $this->expectException(Exception::class);

        OutboxRepository::buildTerminalDeleteSql('ps_outbox', $status, 7, 1000);
    }

    public static function terminalStatusProvider(): array
    {
        return [
            'delivered' => ['delivered'],
            'failed' => ['failed'],
        ];
    }

    public static function nonTerminalStatusProvider(): array
    {
        return [
            'pending' => ['pending'],
            'processing' => ['processing'],
            'empty' => [''],
            'null' => [null],
            'wildcard' => ['%'],
            'injected disjunction' => ['delivered" OR 1=1 -- '],
            'wrong case' => ['DELIVERED'],
        ];
    }

    public function testABuiltDeleteIsAlwaysBoundedAndDeterministicallyOrdered(): void
    {
        $sql = OutboxRepository::buildTerminalDeleteSql('ps_outbox', 'failed', 30, 250);

        // `updated_at` is not unique, so without the `id` tiebreaker the LIMIT
        // picks an arbitrary row set and statement-based replication flags it.
        $this->assertStringContainsString('ORDER BY `updated_at` ASC, `id` ASC', $sql);
        $this->assertStringContainsString('LIMIT 250', $sql);
    }

    public function testTheAgeHorizonIsOmittedWhenTheCapIsDriving(): void
    {
        // The cap prunes the oldest terminal rows whatever their age, so it
        // passes no horizon. It must still be one status at a time.
        $sql = OutboxRepository::buildTerminalDeleteSql('ps_outbox', 'delivered', null, 10);

        $this->assertStringNotContainsString('DATE_SUB', $sql);
    }

    public function testThePassBudgetIsPositiveAndBoundedByTheCap(): void
    {
        $budget = OutboxRepository::retentionBudgetPerPass();

        $this->assertGreaterThan(0, $budget);
        $this->assertLessThanOrEqual(OutboxRepository::RETENTION_MAX_ROWS, $budget);
    }
}
