<?php

use PHPUnit\Framework\TestCase;

/**
 * A dead cron must be visible (#2618).
 *
 * @see CronHealth
 */
class CronHealthTest extends TestCase
{
    private const NOW = 1767225600; // 2026-01-01 00:00:00 UTC

    public function testNeverHavingRunIsStale(): void
    {
        $state = CronHealth::assess(null, self::NOW);

        self::assertFalse($state['ran']);
        self::assertTrue($state['stale']);
        self::assertNull($state['age_seconds']);
    }

    public function testAnEmptyValueIsTreatedAsNeverHavingRun(): void
    {
        self::assertFalse(CronHealth::assess('   ', self::NOW)['ran']);
    }

    public function testAnUnparseableValueIsStaleRatherThanFresh(): void
    {
        $state = CronHealth::assess('not a date', self::NOW);

        self::assertFalse($state['ran']);
        self::assertTrue($state['stale']);
    }

    public function testARecentPassIsFresh(): void
    {
        $state = CronHealth::assess(gmdate('Y-m-d H:i:s', self::NOW - 120), self::NOW);

        self::assertTrue($state['ran']);
        self::assertFalse($state['stale']);
        self::assertSame(120, $state['age_seconds']);
    }

    public function testAnHourlyCronIsNotReportedAsStale(): void
    {
        // The shortest interval some hosting tiers offer. Such a shop is slow,
        // not broken, so it must not sit under a permanent alarm.
        $state = CronHealth::assess(gmdate('Y-m-d H:i:s', self::NOW - 3600), self::NOW);

        self::assertFalse($state['stale']);
    }

    public function testAPassOlderThanTheThresholdIsStale(): void
    {
        $lastRun = gmdate('Y-m-d H:i:s', self::NOW - CronHealth::STALE_AFTER_SECONDS - 1);

        self::assertTrue(CronHealth::assess($lastRun, self::NOW)['stale']);
    }

    public function testAClockThatMovedBackwardsReadsAsFresh(): void
    {
        $state = CronHealth::assess(gmdate('Y-m-d H:i:s', self::NOW + 600), self::NOW);

        self::assertSame(0, $state['age_seconds']);
        self::assertFalse($state['stale']);
    }
}
