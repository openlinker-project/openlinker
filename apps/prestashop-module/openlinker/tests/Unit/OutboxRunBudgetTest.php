<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/ps-sql-functions.php';

/**
 * Unit tests for the per-run wall-clock budget and the stale-lease guards (#2652).
 *
 * The delivery loop itself needs a PrestaShop runtime, so what is testable here
 * is the pure arithmetic it consults plus the SQL fragment that decides which
 * rows a reclaim may touch. Both have a wrong answer that is silent in
 * production: a budget that never stops leaves the host to kill the process
 * mid-loop, and a reclaim without an owner guard delivers the same event twice.
 *
 * @see OutboxRepository
 */
class OutboxRunBudgetTest extends TestCase
{
    public function testTheDefaultBudgetIsBelowTheTightestDocumentedHostingLimit(): void
    {
        // AZ.pl's lowest tier kills a PHP process at 300 s, and the budget only
        // bounds the delivery loop - bootstrap, the claim and retention are
        // paid on top of it.
        $this->assertLessThan(300, OutboxRepository::DEFAULT_RUN_BUDGET_SECONDS);
        $this->assertLessThan(300, OutboxRepository::RUN_BUDGET_SECONDS_MAX);
    }

    public function testAnUnsetBudgetFallsBackToTheDefault(): void
    {
        $this->assertSame(
            OutboxRepository::DEFAULT_RUN_BUDGET_SECONDS,
            OutboxRepository::resolveRunBudgetSeconds(false)
        );
        $this->assertSame(
            OutboxRepository::DEFAULT_RUN_BUDGET_SECONDS,
            OutboxRepository::resolveRunBudgetSeconds('')
        );
    }

    public function testAZeroBudgetFallsBackToTheDefaultRatherThanStoppingEveryRun(): void
    {
        // A stored "0" is falsy in PHP, so it must not be read as a real
        // budget - it would stop the loop before its first delivery.
        $this->assertSame(
            OutboxRepository::DEFAULT_RUN_BUDGET_SECONDS,
            OutboxRepository::resolveRunBudgetSeconds('0')
        );
    }

    public function testAnOversizedBudgetIsClampedToTheCeiling(): void
    {
        $this->assertSame(
            OutboxRepository::RUN_BUDGET_SECONDS_MAX,
            OutboxRepository::resolveRunBudgetSeconds(100000)
        );
    }

    public function testAnInRangeBudgetIsHonoured(): void
    {
        $this->assertSame(90, OutboxRepository::resolveRunBudgetSeconds('90'));
    }

    /**
     * Asserted with a REALISTIC elapsed value, not with 0 (#2660 review).
     *
     * A pass takes its clock before the stale sweep and the batch claim, so
     * elapsed is never 0 by the time the first delivery is considered. Pinning
     * the guarantee at 0 asserted a branch no real pass reaches, which is why
     * the earlier elapsed-based implementation passed its test while the
     * property it documented was absent: on a large outbox the first iteration
     * refused, the batch was requeued, and the queue never drained.
     */
    public function testTheFirstDeliveryOfAPassIsAllowedEvenPastTheBudget(): void
    {
        $this->assertTrue(OutboxRepository::hasBudgetForAnotherDelivery(21.0, 30, 10, 0));
    }

    public function testTheSecondDeliveryIsNoLongerExempt(): void
    {
        // Same numbers, one delivery already made: the exemption is spent and
        // the ordinary worst-case check applies.
        $this->assertFalse(OutboxRepository::hasBudgetForAnotherDelivery(21.0, 30, 10, 1));
    }

    public function testADeliveryThatFitsInsideTheBudgetIsAllowed(): void
    {
        $this->assertTrue(OutboxRepository::hasBudgetForAnotherDelivery(110, 120, 10, 1));
    }

    public function testADeliveryThatCouldCrossTheBudgetIsRefused(): void
    {
        // 110.5 + 10 > 120: the check is on the worst case of the NEXT
        // delivery, not on whether the budget has already been passed.
        $this->assertFalse(OutboxRepository::hasBudgetForAnotherDelivery(110.5, 120, 10, 1));
    }

    /**
     * A caller that omits the counter gets the strict check, never a free pass.
     *
     * The parameter is optional for source compatibility, and the wrong default
     * would exempt EVERY iteration rather than only the first.
     */
    public function testAnOmittedDeliveryCountDoesNotExemptTheCheck(): void
    {
        $this->assertFalse(OutboxRepository::hasBudgetForAnotherDelivery(21.0, 30, 10));
    }

    public function testTheStaleFloorExceedsTheLongestALiveRunCanHoldALease(): void
    {
        $budget = OutboxRepository::DEFAULT_RUN_BUDGET_SECONDS;
        $worstCase = 10;

        $floorSeconds = OutboxRepository::minimumStaleThresholdMinutes($budget, $worstCase) * 60;

        $this->assertGreaterThan($budget + $worstCase, $floorSeconds);
    }

    public function testTheStaleFloorRisesWithTheBudget(): void
    {
        $this->assertGreaterThan(
            OutboxRepository::minimumStaleThresholdMinutes(60, 10),
            OutboxRepository::minimumStaleThresholdMinutes(280, 10)
        );
    }

    public function testAnUnsetStaleThresholdFallsBackToTheDefaultOrTheFloor(): void
    {
        $floor = 3;

        $this->assertSame(
            max(OutboxRepository::DEFAULT_STALE_PROCESSING_THRESHOLD_MINUTES, $floor),
            OutboxRepository::resolveStaleThresholdMinutes(false, $floor)
        );
    }

    public function testAStaleThresholdBelowTheFloorIsRaisedToIt(): void
    {
        // Never rejected outright: an operator who typed 1 gets the shortest
        // safe value and a working outbox, not a double-delivering one.
        $this->assertSame(7, OutboxRepository::resolveStaleThresholdMinutes(1, 7));
    }

    public function testAnOversizedStaleThresholdIsClampedToTheCeiling(): void
    {
        $this->assertSame(
            OutboxRepository::STALE_PROCESSING_THRESHOLD_MINUTES_MAX,
            OutboxRepository::resolveStaleThresholdMinutes(999999, 3)
        );
    }

    public function testAnInRangeStaleThresholdIsHonoured(): void
    {
        $this->assertSame(20, OutboxRepository::resolveStaleThresholdMinutes('20', 3));
    }

    public function testTheReclaimExcludesTheCallingRunsOwnLeases(): void
    {
        $predicate = OutboxRepository::otherOwnerPredicate('cron_abc');

        $this->assertStringContainsString('`processing_owner`', $predicate);
        $this->assertStringContainsString('<> "cron_abc"', $predicate);
        // A NULL owner is not this run's lease, so it stays reclaimable.
        $this->assertStringContainsString('`processing_owner` IS NULL', $predicate);
    }

    public function testACallerWithNoIdentityAddsNoOwnerPredicate(): void
    {
        $this->assertSame('', OutboxRepository::otherOwnerPredicate(null));
        $this->assertSame('', OutboxRepository::otherOwnerPredicate(''));
    }

    public function testTheOwnerPredicateEscapesTheRunId(): void
    {
        $predicate = OutboxRepository::otherOwnerPredicate('a"b');

        $this->assertStringContainsString('\\"', $predicate);
    }

    /**
     * Both reclaims run SQL, so what a unit test can pin is that neither one
     * builds its statement without the owner guard. Two overlapping runs - a
     * cron and an operator pressing the manual button - reclaiming each
     * other's leases is the double-delivery this guard exists to stop.
     */
    public function testBothReclaimsApplyTheOwnerGuard(): void
    {
        $source = self::sourceOf('classes/OutboxRepository.php');

        $this->assertSame(
            2,
            substr_count($source, 'self::otherOwnerPredicate($'),
            'Both requeueStaleProcessingRows() and requeueAllProcessingRows() must apply the owner guard'
        );
    }

    /**
     * The manual reclaim used to match every `processing` row with no age
     * predicate at all, which is what let it take a live cron run's leases.
     */
    public function testTheManualReclaimIsAgeBounded(): void
    {
        $source = self::sourceOf('classes/OutboxRepository.php');

        $this->assertSame(
            2,
            substr_count($source, "' MINUTE)'"),
            'Both reclaims must be bounded by an age predicate'
        );
    }

    /**
     * A run that stops on its budget must release what it did not reach, or
     * those rows sit in `processing` until the stale sweep reaches them -
     * which is the stall this whole change removes.
     */
    public function testTheDeliveryPassReleasesRowsItDidNotReach(): void
    {
        $source = self::sourceOf('classes/DeliveryRunner.php');

        $this->assertStringContainsString('hasBudgetForAnotherDelivery', $source);
        $this->assertStringContainsString('budgetExhausted', $source);
        $this->assertStringContainsString('requeueEventsByRunId', $source);

        // The delivery counter must reach the budget check, or the
        // first-delivery guarantee is unreachable again (#2660 review).
        $this->assertMatchesRegularExpression(
            '/hasBudgetForAnotherDelivery\(\s*microtime\(true\) - \$startedAt,\s*\$budgetSeconds,\s*\$worstCaseDelivery,\s*\$attempted/',
            $source
        );
    }

    private static function sourceOf(string $relativePath): string
    {
        $path = __DIR__ . '/../../' . $relativePath;
        self::assertFileExists($path);

        return (string) file_get_contents($path);
    }
}
