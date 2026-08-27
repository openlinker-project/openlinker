<?php

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the retry delay (#2614).
 *
 * The delay is random, so the randomness is a parameter and every assertion
 * here is about a bound rather than a value. What must hold: the jitter never
 * lifts a delay above its cap, never drops one to near zero, and the endpoint
 * failure streak raises the floor for a row that has no history of its own -
 * the shape that made a dead endpoint cost one fresh retry ladder per change.
 *
 * @see OutboxRepository::computeRetryDelaySeconds
 */
class OutboxRetryBackoffTest extends TestCase
{
    private const BASE = OutboxRepository::RETRY_BASE_DELAY_SECONDS;
    private const MAX = OutboxRepository::RETRY_MAX_DELAY_SECONDS;

    private function delay($attempts, $streak, $jitter)
    {
        return OutboxRepository::computeRetryDelaySeconds(
            $attempts,
            $streak,
            self::BASE,
            2.0,
            self::MAX,
            $jitter
        );
    }

    // Jitter bounds

    public function testJitterNeverExceedsTheComputedDelay(): void
    {
        $this->assertSame(self::BASE, $this->delay(0, 0, 1.0));
    }

    public function testJitterNeverFallsBelowHalfTheComputedDelay(): void
    {
        $this->assertSame((int)(self::BASE / 2), $this->delay(0, 0, 0.0));
    }

    public function testEveryJitterDrawStaysInsideTheBounds(): void
    {
        for ($step = 0; $step <= 20; $step++) {
            $delay = $this->delay(3, 0, $step / 20);

            $expected = self::BASE * 8;
            $this->assertGreaterThanOrEqual((int)($expected / 2), $delay);
            $this->assertLessThanOrEqual($expected, $delay);
        }
    }

    public function testTwoRowsThatFailedTogetherCanBeSpreadApart(): void
    {
        // The point of jitter: identical inputs plus different draws must not
        // produce the same second.
        $this->assertNotSame($this->delay(5, 0, 0.0), $this->delay(5, 0, 1.0));
    }

    public function testTheDelayIsNeverZero(): void
    {
        $this->assertGreaterThan(0, OutboxRepository::computeRetryDelaySeconds(0, 0, 1, 2.0, 1, 0.0));
    }

    // The per-row ceiling still holds

    public function testTheRowCurveIsCappedAtTheMaximumDelay(): void
    {
        $this->assertSame(self::MAX, $this->delay(25, 0, 1.0));
    }

    public function testAJitteredCappedDelayStillNeverExceedsTheCap(): void
    {
        $this->assertLessThanOrEqual(self::MAX, $this->delay(40, 16, 1.0));
    }

    // The endpoint streak

    public function testAFreshRowWaitsForTheEndpointNotForItsOwnFirstAttempt(): void
    {
        $healthy = $this->delay(0, 0, 1.0);
        $duringOutage = $this->delay(0, 8, 1.0);

        $this->assertGreaterThan($healthy, $duringOutage);
    }

    public function testTheEndpointCurveIsCappedSoRecoveryIsStillNoticed(): void
    {
        // The endpoint delay doubles as the probe interval, so it must stay far
        // below the six-hour per-row ceiling.
        $this->assertSame(
            OutboxRepository::ENDPOINT_MAX_DELAY_SECONDS,
            $this->delay(0, OutboxRepository::ENDPOINT_FAILURE_STREAK_MAX, 1.0)
        );
        $this->assertLessThan(self::MAX, OutboxRepository::ENDPOINT_MAX_DELAY_SECONDS);
    }

    public function testAClearedStreakBringsAFreshRowStraightBack(): void
    {
        $this->assertSame(self::BASE, $this->delay(0, 0, 1.0));
    }

    public function testAnOldRowKeepsItsOwnLongerDelay(): void
    {
        // The endpoint cap must not shorten the backoff of a row that is
        // failing on its own account.
        $this->assertGreaterThan(
            OutboxRepository::ENDPOINT_MAX_DELAY_SECONDS,
            $this->delay(20, 0, 1.0)
        );
    }

    public function testTheDelayNeverShrinksAsFailuresAccumulate(): void
    {
        $previous = 0;
        for ($streak = 0; $streak <= 20; $streak++) {
            $delay = $this->delay($streak, $streak, 1.0);
            $this->assertGreaterThanOrEqual($previous, $delay);
            $previous = $delay;
        }
    }

    // The streak counter

    public function testTheStreakGrowsByOnePerFailingRun(): void
    {
        $this->assertSame(1, OutboxRepository::nextEndpointFailureStreak(0));
        $this->assertSame(4, OutboxRepository::nextEndpointFailureStreak(3));
    }

    public function testTheStreakIsCapped(): void
    {
        $max = OutboxRepository::ENDPOINT_FAILURE_STREAK_MAX;

        $this->assertSame($max, OutboxRepository::nextEndpointFailureStreak($max));
        $this->assertSame($max, OutboxRepository::nextEndpointFailureStreak($max + 100));
    }

    public function testAGarbageStreakIsTreatedAsNone(): void
    {
        $this->assertSame(1, OutboxRepository::nextEndpointFailureStreak(-5));
        $this->assertSame(self::BASE, $this->delay(0, -5, 1.0));
    }
}
