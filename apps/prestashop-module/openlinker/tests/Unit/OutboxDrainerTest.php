<?php

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for OutboxDrainer::drainBatch() (#2624).
 *
 * This is the claim-send-mark loop shared by the cron controller and the
 * response-flush fast path — a defect here reaches both delivery paths, so
 * it is covered independently of either caller. No PrestaShop/DB dependency:
 * the repository and sender are plain test doubles, and `$maxAttempts` is a
 * parameter rather than a `Configuration::get()` read inside the method
 * under test (see OutboxDrainer's own docblock for why).
 *
 * @see OutboxDrainer
 */
class OutboxDrainerTest extends TestCase
{
    private function makeEvent($id, $attempts = 0)
    {
        $event = new stdClass();
        $event->id = $id;
        $event->attempts = $attempts;
        return $event;
    }

    public function testReturnsZeroedResultWithoutCallingTheSenderWhenNothingIsClaimed(): void
    {
        $repository = new FakeOutboxDrainerRepository([]);
        $sender = new FakeOutboxDrainerSender();

        $result = OutboxDrainer::drainBatch($repository, $sender, 5, 'run-1');

        $this->assertSame(['claimed' => 0, 'delivered' => 0, 'failed' => 0], $result);
        $this->assertSame([], $sender->sentEventIds);
    }

    public function testMarksEverySuccessfullySentEventDelivered(): void
    {
        $repository = new FakeOutboxDrainerRepository([$this->makeEvent(1), $this->makeEvent(2)]);
        $sender = new FakeOutboxDrainerSender(); // succeeds by default

        $result = OutboxDrainer::drainBatch($repository, $sender, 5, 'run-1');

        $this->assertSame(['claimed' => 2, 'delivered' => 2, 'failed' => 0], $result);
        $this->assertSame([1, 2], $repository->deliveredIds);
        $this->assertSame([], $repository->retriedIds);
        $this->assertSame([], $repository->failedIds);
    }

    public function testSchedulesARetryWhenSendingThrowsAndAttemptsAreBelowTheMax(): void
    {
        $repository = new FakeOutboxDrainerRepository([$this->makeEvent(5, 2)]);
        $sender = new FakeOutboxDrainerSender(['5' => new Exception('boom')]);

        $result = OutboxDrainer::drainBatch($repository, $sender, 5, 'run-1', null, 25);

        $this->assertSame(['claimed' => 1, 'delivered' => 0, 'failed' => 1], $result);
        $this->assertSame([5], $repository->retriedIds);
        $this->assertSame([], $repository->failedIds);
    }

    public function testMarksFailedInsteadOfRetryingOnceAttemptsReachTheMax(): void
    {
        $repository = new FakeOutboxDrainerRepository([$this->makeEvent(6, 25)]);
        $sender = new FakeOutboxDrainerSender(['6' => new Exception('boom')]);

        $result = OutboxDrainer::drainBatch($repository, $sender, 5, 'run-1', null, 25);

        $this->assertSame(['claimed' => 1, 'delivered' => 0, 'failed' => 1], $result);
        $this->assertSame([], $repository->retriedIds);
        $this->assertSame([6], $repository->failedIds);
    }

    public function testSchedulesARetryWhenSendingRaisesAnErrorRatherThanAnException(): void
    {
        // A TypeError/Error does not extend Exception - if drainBatch ever
        // regresses to `catch (Exception ...)`, this event's Error escapes
        // the loop uncaught instead of being retried, and PHPUnit reports it
        // as an uncaught-error test failure rather than an assertion failure.
        $repository = new FakeOutboxDrainerRepository([$this->makeEvent(9, 1)]);
        $sender = new FakeOutboxDrainerSender(['9' => new TypeError('bad argument')]);

        $result = OutboxDrainer::drainBatch($repository, $sender, 5, 'run-1', null, 25);

        $this->assertSame(['claimed' => 1, 'delivered' => 0, 'failed' => 1], $result);
        $this->assertSame([9], $repository->retriedIds);
        $this->assertSame([], $repository->failedIds);
    }

    public function testSchedulesARetryWhenTheSenderReturnsFalseInsteadOfThrowing(): void
    {
        $repository = new FakeOutboxDrainerRepository([$this->makeEvent(7)]);
        $sender = new FakeOutboxDrainerSender();
        $sender->falseFor = [7];

        $result = OutboxDrainer::drainBatch($repository, $sender, 5, 'run-1');

        $this->assertSame(['claimed' => 1, 'delivered' => 0, 'failed' => 1], $result);
        $this->assertSame([7], $repository->retriedIds);
    }

    public function testPassesTheBatchSizeRunIdAndObjectTypesThroughToTheClaim(): void
    {
        $repository = new FakeOutboxDrainerRepository([]);
        $sender = new FakeOutboxDrainerSender();

        OutboxDrainer::drainBatch($repository, $sender, 5, 'run-xyz', ['stock', 'order']);

        $this->assertSame([5, 'run-xyz', ['stock', 'order']], $repository->lastClaimArgs);
    }
}

class FakeOutboxDrainerRepository
{
    /** @var array */
    private $events;

    /** @var array|null */
    public $lastClaimArgs;

    public $deliveredIds = [];
    public $retriedIds = [];
    public $failedIds = [];

    public function __construct(array $events)
    {
        $this->events = $events;
    }

    public function claimBatchDueForDelivery($limit, $runId, $objectTypes = null)
    {
        $this->lastClaimArgs = [$limit, $runId, $objectTypes];
        return $this->events;
    }

    public function markDelivered($outboxId)
    {
        $this->deliveredIds[] = $outboxId;
        return true;
    }

    public function scheduleRetry($outboxId, $attemptNumber, $errorMessage)
    {
        $this->retriedIds[] = $outboxId;
        return true;
    }

    public function markFailed($outboxId, $errorMessage)
    {
        $this->failedIds[] = $outboxId;
        return true;
    }
}

class FakeOutboxDrainerSender
{
    /** @var array<string, Throwable> keyed by event id */
    private $throwFor;

    /** @var array<int|string> event ids for which sendEvent() returns false */
    public $falseFor = [];

    public $sentEventIds = [];

    public function __construct(array $throwFor = [])
    {
        $this->throwFor = $throwFor;
    }

    public function sendEvent($event)
    {
        $this->sentEventIds[] = $event->id;

        if (isset($this->throwFor[(string)$event->id])) {
            throw $this->throwFor[(string)$event->id];
        }

        return !in_array($event->id, $this->falseFor, true);
    }
}
