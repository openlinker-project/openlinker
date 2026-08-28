<?php
/**
 * Outbox Repository
 *
 * The single owner of all database operations on the outbox table.
 * Implements a durable, transactional queue abstraction that turns PrestaShop
 * hooks into safe, retryable, idempotent webhook triggers.
 *
 * Responsibilities:
 * - State machine management (pending → processing → delivered/failed)
 * - Atomic claiming with concurrency safety
 * - Retry policy with exponential backoff
 * - Stale row recovery
 * - Retention (pruning terminal rows so the table cannot grow without bound)
 * - Clean API for hooks and cron
 *
 * This is NOT business logic and NOT HTTP logic - only DB state, retries, locking.
 *
 * @module prestashop-module/classes
 * @see {@link OutboxEvent} for the event model
 * @see {@link WebhookSender} for HTTP delivery
 */

class OutboxRepository
{
    // Stale row recovery threshold (events stuck in processing longer than
    // this are requeued). Kept as the fallback for an unset or unusable
    // configuration value - see resolveStaleThresholdMinutes() (#2652).
    const STALE_PROCESSING_THRESHOLD_MINUTES = 15;

    // Per-run wall-clock budget (#2652, AC3 of #2614).
    //
    // There was no cap at all: the worst delivery path is BATCH_SIZE (50 by
    // default) rows x WebhookSender::HTTP_TIMEOUT_SECONDS (10 s), i.e. 500 s,
    // while AZ.pl's lowest shared tier kills a PHP process at 300 s. The
    // process died mid-loop, its claimed rows stayed `processing`, and nothing
    // recovered them until the stale sweep.
    //
    // 120 s is deliberately well under that 300 s: the budget bounds the
    // delivery loop only, and a run also pays for PHP bootstrap, the claim, the
    // retention pass and one delivery that may overshoot the check by up to the
    // HTTP timeout. Leaving that much headroom is what turns a kill into a
    // clean stop. Rows not reached stay `pending` for the next run, so the
    // budget costs latency, never events.
    const DEFAULT_RUN_BUDGET_SECONDS = 120;

    // Below the floor a run cannot finish a single delivery plus its own
    // overhead, so the queue would never drain. Above the ceiling the run is
    // back inside the range where the tightest documented hosting limit
    // (300 s) can kill it, which is the whole failure this removes.
    const RUN_BUDGET_SECONDS_MIN = 30;
    const RUN_BUDGET_SECONDS_MAX = 280;
    const RUN_BUDGET_CONFIG_KEY = 'OPENLINKER_OUTBOX_RUN_BUDGET_SECONDS';

    // Stale-lease threshold, now an operator dial (#2652, AC4 of #2614).
    //
    // Fifteen minutes was a class constant, so a shop whose host kills
    // processes at 60 s waited a quarter of an hour after the outage ended
    // before its rows moved again, and had no way to change that without
    // editing PHP.
    //
    // Five minutes is the default because that is what a killed run actually
    // costs: a run cannot legitimately hold a lease for longer than its budget
    // plus one delivery, and at the default budget that is a little over two
    // minutes. See minimumStaleThresholdMinutes() for the floor this must
    // never go below - a threshold shorter than a live run steals live work.
    const DEFAULT_STALE_PROCESSING_THRESHOLD_MINUTES = 5;
    const STALE_PROCESSING_THRESHOLD_MINUTES_MAX = 1440; // 24 h
    const STALE_PROCESSING_THRESHOLD_CONFIG_KEY = 'OPENLINKER_OUTBOX_STALE_MINUTES';

    // Slack between the longest a live run can hold a lease and the earliest a
    // peer may reclaim it. Absorbs clock skew between the PHP host and MySQL,
    // and the seconds between the claim and the first delivery.
    const STALE_THRESHOLD_SAFETY_SECONDS = 60;

    // Retry backoff constants
    const RETRY_BASE_DELAY_SECONDS = 60; // 1 minute
    const RETRY_MAX_DELAY_SECONDS = 21600; // 6 hours

    // Endpoint-level backoff (#2614).
    //
    // A row's own `attempts` is the wrong unit for an outage. Every hook fire
    // during one enqueues a fresh row at attempts = 0, so a permanently dead
    // endpoint was retried from scratch per row and retry pressure grew with
    // the number of changes the shop made. The failure streak below is kept per
    // endpoint, not per row, so pressure stays flat however many rows queue up,
    // and one success clears it for every row at once.
    const ENDPOINT_FAILURE_STREAK_CONFIG_KEY = 'OPENLINKER_OUTBOX_FAILURE_STREAK';

    // Deliberately far below RETRY_MAX_DELAY_SECONDS. The endpoint delay is
    // also the probe interval, so capping it at six hours would mean an outage
    // that ended could go unnoticed for six hours. Fifteen minutes bounds both
    // the wasted requests and the time to notice recovery.
    const ENDPOINT_MAX_DELAY_SECONDS = 900; // 15 minutes

    // Nothing above this exponent can change the answer once the endpoint delay
    // is capped, and it keeps the stored counter small.
    const ENDPOINT_FAILURE_STREAK_MAX = 16;

    // Jitter (#2614). Uniform over [0.5 * delay, delay], so fifty rows that
    // failed in the same second do not retry in the same second. The lower
    // bound is half the computed delay and never smaller: full jitter would
    // occasionally pick a near-zero delay and hammer an endpoint that is still
    // down, which is the pressure this is meant to remove.
    const RETRY_JITTER_MIN_FRACTION = 0.5;

    // Statistics window
    const STATISTICS_DELIVERED_WINDOW_HOURS = 24;

    // Retention (#2604). Only terminal rows are ever eligible for deletion:
    // `delivered` and `failed`. A `pending` row is queued or waiting on a
    // backoff, and a `processing` row is leased by a live cron run - deleting
    // either would lose an event, which is the failure mode this whole outbox
    // exists to prevent.

    // Successful history is operational noise once OpenLinker has the event.
    // Operator-configurable because the useful horizon depends on how long the
    // shop wants to be able to answer "did that change get sent".
    const DEFAULT_RETENTION_DELIVERED_DAYS = 7;
    const RETENTION_DELIVERED_DAYS_MIN = 1;
    const RETENTION_DELIVERED_DAYS_MAX = 365;
    const RETENTION_DAYS_CONFIG_KEY = 'OPENLINKER_OUTBOX_RETENTION_DAYS';

    // A failed row is evidence, so it outlives a delivered one and is not on
    // the operator's dial. Deliberately independent of the delivered horizon:
    // #2603 removed a setting whose whole defect was two numbers having to be
    // set in the right relation to each other.
    const RETENTION_FAILED_DAYS = 30;

    // Hard ceiling on the whole table. Reached only when the age horizons are
    // not keeping up (a burst, or a shop with far more churn than the horizon
    // assumes). See enforceRowCap() for what happens at the ceiling.
    const RETENTION_MAX_ROWS = 100000;

    // A live shop cannot afford one unbounded DELETE holding row locks across
    // the whole table, so every pass deletes in bounded statements and stops.
    // Whatever is left is deleted by the next pass.
    const RETENTION_DELETE_BATCH_SIZE = 1000;
    const RETENTION_MAX_BATCHES_PER_PASS = 10;

    // The cron runs as often as once a minute; scanning for prunable rows that
    // often buys nothing.
    const RETENTION_MIN_INTERVAL_SECONDS = 3600;
    const RETENTION_LAST_RUN_CONFIG_KEY = 'OPENLINKER_OUTBOX_RETENTION_LAST_RUN';

    private $tableName;

    // Null until probed once, then the cached answer for this request.
    private $hasDedupKeyColumn = null;

    // The failure streak counts failing runs, not failing rows. One cron pass
    // that fails on fifty rows is one failure, or a single outage would jump
    // straight to the cap and stay there.
    private $endpointFailureRecordedThisRun = false;

    public function __construct()
    {
        $this->tableName = _DB_PREFIX_ . 'openlinker_webhook_outbox';
    }

    /**
     * Enqueue a new event to the outbox
     *
     * Called from hooks. Guarantees:
     * - Event is persisted
     * - eventId generated once (stable across retries)
     * - status = pending
     * - Timestamps set
     * - Hook returns immediately (non-blocking)
     *
     * @param array $eventData Event data with keys:
     *   - eventId (optional, will be generated if not provided)
     *   - connectionId (required)
     *   - eventType (required)
     *   - objectType (required)
     *   - externalId (required)
     *   - occurredAt (optional, defaults to NOW())
     *   - payloadJson (optional)
     * @return int Outbox record ID
     * @throws Exception On database error or duplicate eventId
     */
    public function enqueueEvent(array $eventData)
    {
        // Generate eventId if not provided
        if (empty($eventData['eventId'])) {
            $eventData['eventId'] = EventIdGenerator::generateEventId(
                'prestashop',
                $eventData['connectionId'],
                $eventData['eventType'],
                $eventData['objectType'],
                $eventData['externalId'],
                $eventData['occurredAt'] ?? date('Y-m-d H:i:s')
            );
        }

        // A caller may pass dedupKey => null to opt out of coalescing entirely
        // (the admin "Test connection" probe does, so a stuck row from an
        // earlier failed probe can never swallow the next one).
        if (array_key_exists('dedupKey', $eventData)) {
            // Normalise any falsy value to NULL. An empty string is not
            // NULL-distinct, so one such row would block every other subject.
            $dedupKey = empty($eventData['dedupKey']) ? null : $eventData['dedupKey'];
        } else {
            $dedupKey = EventIdGenerator::generateDedupKey(
                'prestashop',
                $eventData['connectionId'],
                $eventData['eventType'],
                $eventData['objectType'],
                $eventData['externalId']
            );
        }

        // If the 1.3.0 upgrade never ran, the column does not exist and every
        // insert would throw, so the shop would stop emitting events with only a
        // log line to show for it. Degrade to no coalescing instead: a duplicate
        // costs one redundant pull, a silent stop costs the operator their sync.
        if (!$this->hasDedupKeyColumn()) {
            $dedupKey = null;
        }

        // Set defaults
        $now = date('Y-m-d H:i:s');
        $occurredAt = $eventData['occurredAt'] ?? $now;

        // INSERT IGNORE collides on `dedup_key`, which is only ever set while a
        // row is queued. A burst of identical hook fires therefore collapses
        // onto one row, while a change made after the previous row was
        // delivered gets a row of its own (#2603).
        $sql = 'INSERT IGNORE INTO `' . $this->tableName . '` (
            `event_id`,
            ' . ($this->hasDedupKeyColumn() ? '`dedup_key`,' : '') . '
            `schema_version`,
            `provider`,
            `connection_id`,
            `event_type`,
            `object_type`,
            `external_id`,
            `occurred_at`,
            `payload_json`,
            `status`,
            `attempts`,
            `created_at`,
            `updated_at`
        ) VALUES (
            "' . pSQL($eventData['eventId']) . '",
            ' . ($this->hasDedupKeyColumn() ? ($dedupKey === null ? 'NULL,' : '"' . pSQL($dedupKey) . '",') : '') . '
            1,
            "prestashop",
            "' . pSQL($eventData['connectionId']) . '",
            "' . pSQL($eventData['eventType']) . '",
            "' . pSQL($eventData['objectType']) . '",
            "' . pSQL($eventData['externalId']) . '",
            "' . pSQL($occurredAt) . '",
            ' . ($eventData['payloadJson'] ? '"' . pSQL($eventData['payloadJson']) . '"' : 'NULL') . ',
            "pending",
            0,
            "' . $now . '",
            "' . $now . '"
        )';

        // Two attempts, because both outcomes of an ignored insert are
        // recoverable and returning 0 is not: the caller cannot tell it from a
        // failed insert. Either the key is still held by a queued row, in which
        // case that row's id is the right handle, or the holder released it in
        // between, in which case this event has no row anywhere and the insert
        // has to be retried or a real change is lost.
        $insertId = 0;
        for ($attempt = 0; $attempt < 2; $attempt++) {
            if (!Db::getInstance()->execute($sql)) {
                throw new Exception('Failed to enqueue event: ' . Db::getInstance()->getMsgError());
            }

            $insertId = (int)Db::getInstance()->Insert_ID();
            if ($insertId !== 0 || $dedupKey === null) {
                return $insertId;
            }

            $existingSql = 'SELECT `id` FROM `' . $this->tableName . '`
                           WHERE `dedup_key` = "' . pSQL($dedupKey) . '"
                           LIMIT 1';
            $existingRow = Db::getInstance()->getRow($existingSql);
            if ($existingRow && isset($existingRow['id'])) {
                return (int)$existingRow['id'];
            }
        }

        return $insertId;
    }

    /**
     * Is the coalescing column present?
     *
     * Cached per request. A module dropped in without the 1.3.0 upgrade running
     * has the table but not the column.
     *
     * @return bool
     */
    private function hasDedupKeyColumn()
    {
        if ($this->hasDedupKeyColumn !== null) {
            return $this->hasDedupKeyColumn;
        }

        $columns = Db::getInstance()->executeS(
            'SHOW COLUMNS FROM `' . bqSQL($this->tableName) . '` LIKE \'dedup_key\''
        );
        $this->hasDedupKeyColumn = !empty($columns);

        if (!$this->hasDedupKeyColumn && class_exists('PrestaShopLogger')) {
            PrestaShopLogger::addLog(
                'OpenLinker: outbox `dedup_key` column missing - run the module upgrade.'
                    . ' Events are still emitted, but repeat hook fires are no longer coalesced.',
                2,
                null,
                'Module',
                null
            );
        }

        return $this->hasDedupKeyColumn;
    }

    /**
     * Requeue stale processing rows
     *
     * Recovers rows stuck in 'processing' because the process that leased them
     * is gone (a cron killed by the host's process limit is the normal case on
     * shared hosting, not an edge case). Called at the start of every pass.
     *
     * Two guards make "gone" mean gone (#2652):
     *
     * - The age predicate is only sound because the threshold has a floor
     *   derived from the run budget (see minimumStaleThresholdMinutes()). A
     *   live run stops before its budget, so its lease can never be older than
     *   that floor; anything older therefore belongs to a process that is not
     *   coming back.
     * - The owner predicate stops a run reclaiming its own lease. The caller
     *   passes its own runId, which is excluded, so a pass that sweeps before
     *   claiming - and any future caller that sweeps mid-run - can never pull a
     *   row out from under itself and deliver it twice.
     *
     * @param string|null $currentRunId Run id to never reclaim from, if any
     * @param int|null $thresholdMinutes Age threshold; null resolves it from configuration
     * @return int Number of rows requeued
     */
    public function requeueStaleProcessingRows($currentRunId = null, $thresholdMinutes = null)
    {
        if ($thresholdMinutes === null) {
            $thresholdMinutes = self::readStaleThresholdMinutes();
        }

        $sql = 'UPDATE `' . $this->tableName . '`
                SET `status` = "pending",
                    `processing_owner` = NULL,
                    `processing_started_at` = NULL,
                    `last_error` = "Stale processing row requeued (delivery process gone)",
                    `updated_at` = NOW()
                WHERE `status` = "processing"
                AND `processing_started_at` < DATE_SUB(NOW(), INTERVAL ' . (int)$thresholdMinutes . ' MINUTE)'
                . self::otherOwnerPredicate($currentRunId);

        Db::getInstance()->execute($sql);
        return (int)Db::getInstance()->Affected_Rows();
    }

    /**
     * Requeue processing rows an operator is asking to retry now
     *
     * The manual button means "stop waiting", so this is deliberately more
     * eager than the scheduled sweep - but it used to match every `processing`
     * row with no age and no owner predicate at all, so pressing it while a
     * cron pass was mid-flight handed that pass's rows to the manual run and
     * both delivered them (#2652).
     *
     * The grace period below is the shortest window in which an owner can be
     * proven gone rather than merely slow, so a genuinely stuck row is still
     * released within minutes instead of the old fifteen, and a live peer's
     * work is never taken.
     *
     * @param string|null $currentRunId Run id to never reclaim from, if any
     * @param int|null $graceMinutes Age threshold; null derives the liveness floor
     * @return int Number of rows requeued
     */
    public function requeueAllProcessingRows($currentRunId = null, $graceMinutes = null)
    {
        if ($graceMinutes === null) {
            $graceMinutes = self::minimumStaleThresholdMinutes(self::readRunBudgetSeconds());
        }

        $sql = 'UPDATE `' . $this->tableName . '`
                SET `status` = "pending",
                    `processing_owner` = NULL,
                    `processing_started_at` = NULL,
                    `last_error` = "Requeued for manual delivery",
                    `updated_at` = NOW()
                WHERE `status` = "processing"
                AND `processing_started_at` < DATE_SUB(NOW(), INTERVAL ' . (int)$graceMinutes . ' MINUTE)'
                . self::otherOwnerPredicate($currentRunId);

        Db::getInstance()->execute($sql);
        return (int)Db::getInstance()->Affected_Rows();
    }

    /**
     * SQL fragment excluding one run's own leases from a reclaim
     *
     * Pure and public so the property can be pinned by a test: a reclaim that
     * forgets it delivers the reclaiming run's own events twice. An empty
     * runId yields no predicate rather than a comparison against "" - a caller
     * with no identity of its own has nothing to exclude, and matching NULL
     * owners on an equality test would exclude nothing anyway.
     *
     * @param string|null $currentRunId
     * @return string
     */
    public static function otherOwnerPredicate($currentRunId)
    {
        $runId = (string)$currentRunId;
        if ($runId === '') {
            return '';
        }

        return ' AND (`processing_owner` IS NULL OR `processing_owner` <> "' . pSQL($runId) . '")';
    }

    /**
     * Reset next_attempt_at for pending events
     *
     * Resets next_attempt_at to NULL for all pending events, making them
     * immediately available for delivery. Used for manual delivery to force
     * delivery of events that are scheduled for future retry.
     *
     * @return int Number of rows updated
     */
    public function resetNextAttemptForPendingEvents()
    {
        $sql = 'UPDATE `' . $this->tableName . '`
                SET `next_attempt_at` = NULL,
                    `updated_at` = NOW()
                WHERE `status` = "pending"
                AND `next_attempt_at` IS NOT NULL';

        Db::getInstance()->execute($sql);
        return (int)Db::getInstance()->Affected_Rows();
    }

    /**
     * Release rows that were waiting on the endpoint, not on themselves (#2614)
     *
     * Recovery has to release the backlog an outage built up, and must not
     * touch a row that is waiting because it keeps failing on its own. Those
     * two look identical in the table - both are pending with a future
     * next_attempt_at - so the row's own attempt count is the discriminator.
     * Below maxAttempts the wait in effect can only have come from the endpoint
     * curve, because the row's own curve has not yet grown past the endpoint
     * ceiling. Above it, the wait is the row's own history and pulling it
     * forward would let a poison row burn its whole attempt budget in as many
     * cron passes, ending as `failed` - a dropped event, which is the opposite
     * of what this backoff exists to do.
     *
     * @param int $maxAttempts Highest attempt count still considered endpoint-blocked
     * @return int Number of rows released
     */
    public function releaseEndpointBlockedPendingEvents($maxAttempts)
    {
        $sql = 'UPDATE `' . $this->tableName . '`
                SET `next_attempt_at` = NULL,
                    `updated_at` = NOW()
                WHERE `status` = "pending"
                AND `next_attempt_at` IS NOT NULL
                AND `attempts` <= ' . (int)$maxAttempts;

        Db::getInstance()->execute($sql);
        return (int)Db::getInstance()->Affected_Rows();
    }

    /**
     * Requeue events by runId
     *
     * Requeues events that were claimed by a specific runId but not completed.
     * Used for cleanup when delivery process fails.
     *
     * @param string $runId Run identifier
     * @param string $errorMessage Error message to store
     * @return int Number of rows requeued
     */
    public function requeueEventsByRunId($runId, $errorMessage)
    {
        $truncatedError = mb_substr($errorMessage, 0, 1000, 'UTF-8');
        
        $sql = 'UPDATE `' . $this->tableName . '`
                SET `status` = "pending",
                    `processing_owner` = NULL,
                    `processing_started_at` = NULL,
                    `last_error` = "' . pSQL($truncatedError) . '",
                    `updated_at` = NOW()
                WHERE `status` = "processing"
                AND `processing_owner` = "' . pSQL($runId) . '"';

        Db::getInstance()->execute($sql);
        return (int)Db::getInstance()->Affected_Rows();
    }

    /**
     * Claim a batch of events due for delivery (deterministic by runId)
     *
     * Atomically claims rows by runId. Guarantees:
     * - Only one cron run can claim a row
     * - Rows are marked 'processing' with processing_owner=runId
     * - Safe under concurrency
     *
     * This is the lock mechanism - claiming is the lock.
     *
     * Transaction Safety:
     * This method uses a two-step process to ensure atomicity:
     * 1. UPDATE with LIMIT: Atomically marks rows as 'processing' with a specific runId.
     *    This UPDATE is atomic at the database level - only one process can claim a row.
     * 2. SELECT: Retrieves only the rows claimed by this specific runId.
     *
     * The UPDATE statement acts as a distributed lock:
     * - WHERE status='pending' ensures only unclaimed rows are selected
     * - SET processing_owner=runId ensures each cron run claims different rows
     * - LIMIT ensures bounded batch size
     * - ORDER BY created_at ASC ensures FIFO processing
     *
     * Concurrency guarantees:
     * - Multiple cron processes can run simultaneously without conflicts
     * - Each process gets a unique runId and claims different rows
     * - If a process crashes, stale rows are recovered by requeueStaleProcessingRows()
     * - No deadlocks possible (single table, no joins)
     *
     * Note: This is NOT wrapped in a transaction because:
     * - The UPDATE is already atomic (single statement)
     * - The SELECT is read-only and safe
     * - Wrapping in a transaction would hold locks longer than necessary
     * - PrestaShop's Db class may not support transactions on all MySQL versions
     *
     * @param int $limit Maximum number of events to claim
     * @param string $runId Unique run identifier for this cron execution
     * @return array Array of OutboxEvent objects
     */
    public function claimBatchDueForDelivery($limit, $runId)
    {
        // Ensure OutboxEvent class is loaded
        if (!class_exists('OutboxEvent')) {
            $classesDir = dirname(__FILE__) . '/';
            require_once($classesDir . 'OutboxEvent.php');
        }

        // Step 1: Atomically claim rows with this runId
        //
        // The key is released here, not at markDelivered: the HTTP POST happens
        // between the two, so a change arriving in that gap would otherwise
        // collide with a row that has already been sent and be dropped with no
        // log and no row (#2603). Releasing at claim time means such a change
        // gets a row of its own. The cost is a possible duplicate row when a
        // delivery fails and the row is requeued, which is harmless: each row
        // carries its own event id, so OpenLinker enqueues a second job and the
        // pull is idempotent.
        $sql = 'UPDATE `' . $this->tableName . '`
                SET `status` = "processing",
                    ' . ($this->hasDedupKeyColumn() ? '`dedup_key` = NULL,' : '') . '
                    `processing_owner` = "' . pSQL($runId) . '",
                    `processing_started_at` = NOW(),
                    `updated_at` = NOW()
                WHERE `status` = "pending"
                AND (`next_attempt_at` IS NULL OR `next_attempt_at` <= NOW())
                ORDER BY `created_at` ASC
                LIMIT ' . (int)$limit;

        Db::getInstance()->execute($sql);

        // Step 2: SELECT only the rows claimed by this runId
        $sql = 'SELECT * FROM `' . $this->tableName . '`
                WHERE `status` = "processing"
                AND `processing_owner` = "' . pSQL($runId) . '"
                ORDER BY `created_at` ASC';

        $rows = Db::getInstance()->executeS($sql);
        if (!$rows) {
            return [];
        }

        $events = [];
        foreach ($rows as $row) {
            $events[] = OutboxEvent::fromArray($row);
        }

        return $events;
    }

    /**
     * Mark event as delivered
     *
     * Updates status to 'delivered', clears processing_owner, sets delivered_at.
     * Increments attempts counter.
     *
     * @param int $outboxId Outbox record ID
     * @return bool Success
     */
    public function markDelivered($outboxId)
    {
        // The key is normally already NULL, released at claim time. Kept here as
        // a backstop for any row that reaches delivered without being claimed.
        // Guarded: on an install where the upgrade never added the column, an
        // unguarded write here fails with error 1054, the row never reaches a
        // terminal state, and it is requeued as stale and redelivered forever.
        $sql = 'UPDATE `' . $this->tableName . '`
                SET `status` = "delivered",
                    ' . ($this->hasDedupKeyColumn() ? '`dedup_key` = NULL,' : '') . '
                    `processing_owner` = NULL,
                    `processing_started_at` = NULL,
                    `delivered_at` = NOW(),
                    `attempts` = `attempts` + 1,
                    `updated_at` = NOW()
                WHERE `id` = ' . (int)$outboxId;

        $updated = Db::getInstance()->execute($sql);

        if ($updated) {
            $this->recordEndpointRecovery();
        }

        return $updated;
    }

    /**
     * Schedule retry for failed event
     *
     * Calculates exponential backoff, updates status back to 'pending',
     * clears processing_owner, sets next_attempt_at, increments attempts.
     *
     * @param int $outboxId Outbox record ID
     * @param int $attemptNumber Current attempt number (before increment)
     * @param string $errorMessage Error message
     * @param bool $countTowardsEndpointStreak False for a diagnostic probe, whose
     *             outcome says nothing about the delivery endpoint's steady state
     * @return bool Success
     */
    public function scheduleRetry($outboxId, $attemptNumber, $errorMessage, $countTowardsEndpointStreak = true)
    {
        // Get retry configuration
        $maxAttempts = (int)Configuration::get('MAX_RETRY_ATTEMPTS') ?: 25;
        $backoffMultiplier = (float)Configuration::get('RETRY_BACKOFF_MULTIPLIER') ?: 2.0;
        $baseDelay = self::RETRY_BASE_DELAY_SECONDS;
        $maxDelay = self::RETRY_MAX_DELAY_SECONDS;

        // Check if max attempts reached
        if ($attemptNumber >= $maxAttempts) {
            return $this->markFailed($outboxId, $errorMessage);
        }

        // The delay is driven by whichever is worse: this row's own history, or
        // the endpoint's. See computeRetryDelaySeconds.
        $delay = self::computeRetryDelaySeconds(
            $attemptNumber,
            $this->readEndpointFailureStreak(),
            $baseDelay,
            $backoffMultiplier,
            $maxDelay,
            self::randomJitterFraction()
        );

        // Recorded before the row is written, so the next row scheduled in this
        // same pass already sees the streak this pass established.
        if ($countTowardsEndpointStreak) {
            $this->recordEndpointFailure();
        }

        // Calculate next attempt time
        $nextAttemptAt = date('Y-m-d H:i:s', time() + $delay);

        // Truncate error message to fit in TEXT column (max ~65KB, but keep reasonable)
        $truncatedError = mb_substr($errorMessage, 0, 1000, 'UTF-8');

        $sql = 'UPDATE `' . $this->tableName . '`
                SET `status` = "pending",
                    `processing_owner` = NULL,
                    `processing_started_at` = NULL,
                    `next_attempt_at` = "' . pSQL($nextAttemptAt) . '",
                    `last_error` = "' . pSQL($truncatedError) . '",
                    `attempts` = `attempts` + 1,
                    `updated_at` = NOW()
                WHERE `id` = ' . (int)$outboxId;

        return Db::getInstance()->execute($sql);
    }

    /**
     * Mark event as failed (max attempts reached)
     *
     * Updates status to 'failed', clears processing_owner, sets last_error.
     * Does NOT increment attempts (already at max).
     *
     * @param int $outboxId Outbox record ID
     * @param string $errorMessage Error message
     * @return bool Success
     */
    public function markFailed($outboxId, $errorMessage)
    {
        // Truncate error message
        $truncatedError = mb_substr($errorMessage, 0, 1000, 'UTF-8');

        // A failed row is terminal, so it must not keep holding the
        // coalescing key hostage against future changes (#2603). Guarded for the
        // same reason as markDelivered: a missing column must not block the row
        // from reaching a terminal state.
        $sql = 'UPDATE `' . $this->tableName . '`
                SET `status` = "failed",
                    ' . ($this->hasDedupKeyColumn() ? '`dedup_key` = NULL,' : '') . '
                    `processing_owner` = NULL,
                    `processing_started_at` = NULL,
                    `last_error` = "' . pSQL($truncatedError) . '",
                    `updated_at` = NOW()
                WHERE `id` = ' . (int)$outboxId;

        // Deliberately does NOT touch the endpoint failure streak. A row that
        // exhausted its own attempts is per-row history; treating it as
        // evidence about the endpoint would raise the delay floor for every
        // healthy row on a shop whose endpoint is fine.
        return Db::getInstance()->execute($sql);
    }

    /**
     * Retry delay for one row, in seconds (#2614)
     *
     * Pure, so the bounds are assertable without a database and without real
     * randomness.
     *
     * Two exponential curves are compared and the longer delay wins. The row's
     * own curve is uncapped up to RETRY_MAX_DELAY_SECONDS, because a row that
     * has failed twenty times on its own is very likely bad payload and should
     * back off hard. The endpoint's curve is capped at
     * ENDPOINT_MAX_DELAY_SECONDS, because it also has to serve as the probe
     * that notices the endpoint came back.
     *
     * The result is then jittered down by up to half, never up: the caps stay
     * caps.
     *
     * @param int $attemptNumber Attempts already made by this row
     * @param int $failureStreak Consecutive failing delivery runs for the endpoint
     * @param int $baseDelay Base delay in seconds
     * @param float $multiplier Backoff multiplier
     * @param int $maxDelay Ceiling for the per-row curve, in seconds
     * @param float $jitterFraction Randomness in [0, 1]; 1 means no reduction
     * @return int Delay in seconds, at least 1
     */
    public static function computeRetryDelaySeconds(
        $attemptNumber,
        $failureStreak,
        $baseDelay,
        $multiplier,
        $maxDelay,
        $jitterFraction
    ) {
        $baseDelay = max(1, (int)$baseDelay);
        $multiplier = (float)$multiplier;
        if ($multiplier < 1.0) {
            $multiplier = 1.0;
        }
        $maxDelay = max($baseDelay, (int)$maxDelay);

        $rowDelay = min($baseDelay * pow($multiplier, max(0, (int)$attemptNumber)), $maxDelay);

        $streak = max(0, min((int)$failureStreak, self::ENDPOINT_FAILURE_STREAK_MAX));
        $endpointDelay = min(
            $baseDelay * pow($multiplier, $streak),
            min(self::ENDPOINT_MAX_DELAY_SECONDS, $maxDelay)
        );

        $delay = max($rowDelay, $endpointDelay);

        $jitterFraction = (float)$jitterFraction;
        if ($jitterFraction < 0.0) {
            $jitterFraction = 0.0;
        }
        if ($jitterFraction > 1.0) {
            $jitterFraction = 1.0;
        }

        $floor = $delay * self::RETRY_JITTER_MIN_FRACTION;

        return max(1, (int)round($floor + (($delay - $floor) * $jitterFraction)));
    }

    /**
     * Highest attempt count whose wait can still be blamed on the endpoint (#2614)
     *
     * A row that has failed `a` times is waiting `baseDelay * multiplier^(a-1)`
     * on its own curve. While that is no longer than the endpoint ceiling, the
     * wait actually in effect is the endpoint's, so recovery may release it and
     * the row loses at most that much of its own backoff. Past the ceiling the
     * wait is the row's own, and releasing it would destroy the ladder.
     *
     * Derived rather than hardcoded, so a shop that changed the multiplier
     * still gets a threshold that means the same thing.
     *
     * @param int $baseDelay Base delay in seconds
     * @param float $multiplier Backoff multiplier
     * @return int
     */
    public static function endpointBlockedMaxAttempts($baseDelay, $multiplier)
    {
        $baseDelay = max(1, (int)$baseDelay);
        $multiplier = (float)$multiplier;
        if ($multiplier <= 1.0) {
            // A flat curve never outgrows the ceiling, so every row's wait is
            // the endpoint's and releasing any of them costs at most one base
            // delay. Unless the base delay alone is already past the ceiling,
            // in which case no row's wait can be attributed to the endpoint.
            return $baseDelay <= self::ENDPOINT_MAX_DELAY_SECONDS
                ? self::ENDPOINT_FAILURE_STREAK_MAX
                : 0;
        }

        $attempts = 0;
        while ($attempts < self::ENDPOINT_FAILURE_STREAK_MAX
            && $baseDelay * pow($multiplier, $attempts) <= self::ENDPOINT_MAX_DELAY_SECONDS) {
            $attempts++;
        }

        return $attempts;
    }

    /**
     * Next value of the endpoint failure streak (#2614)
     *
     * @param int $current Current streak
     * @return int
     */
    public static function nextEndpointFailureStreak($current)
    {
        return min(max(0, (int)$current) + 1, self::ENDPOINT_FAILURE_STREAK_MAX);
    }

    /**
     * Uniform random fraction in [0, 1]
     *
     * @return float
     */
    private static function randomJitterFraction()
    {
        return mt_rand(0, 1000000) / 1000000;
    }

    /**
     * Read the endpoint failure streak
     *
     * @return int
     */
    private function readEndpointFailureStreak()
    {
        return max(0, (int)Configuration::get(self::ENDPOINT_FAILURE_STREAK_CONFIG_KEY));
    }

    /**
     * Record that a delivery to the endpoint failed (#2614)
     *
     * At most once per PHP process, so one cron pass counts once however many
     * rows it failed on.
     *
     * @return void
     */
    private function recordEndpointFailure()
    {
        if ($this->endpointFailureRecordedThisRun) {
            return;
        }

        $this->endpointFailureRecordedThisRun = true;

        Configuration::updateGlobalValue(
            self::ENDPOINT_FAILURE_STREAK_CONFIG_KEY,
            self::nextEndpointFailureStreak($this->readEndpointFailureStreak())
        );
    }

    /**
     * Record that the endpoint accepted a delivery (#2614)
     *
     * Clears the streak and pulls the outage backlog forward. Without the
     * second half, rows queued during a long outage would keep sitting on
     * delays computed while the endpoint was down, so an operator pressing the
     * button was the only way back - the defect this closes.
     *
     * Only rows still under the endpoint-blocked attempt threshold are
     * released. See releaseEndpointBlockedPendingEvents for why a row past it
     * must keep its own wait.
     *
     * Releasing that backlog at once cannot flood the endpoint: the cron
     * claims at most BATCH_SIZE rows per pass, so the release changes when rows
     * are eligible, never how many are sent at a time.
     *
     * A row's own `attempts` is deliberately NOT reset. It is the only bound
     * that lets a genuinely undeliverable row reach `failed` instead of being
     * retried forever, and it is per-row history rather than endpoint state.
     *
     * The streak itself is a read-modify-write on shared Configuration, so two
     * concurrent cron passes can undercount it by one, or a failing pass can
     * write back a value a concurrent recovery just cleared. Both are bounded
     * to one cycle and both self-heal on the next success, and the effect is
     * only ever on a delay, never on whether a row is delivered - so it is
     * left as it is rather than paid for with a schema change.
     *
     * @return void
     */
    private function recordEndpointRecovery()
    {
        $this->endpointFailureRecordedThisRun = false;

        if ($this->readEndpointFailureStreak() === 0) {
            return;
        }

        Configuration::updateGlobalValue(self::ENDPOINT_FAILURE_STREAK_CONFIG_KEY, 0);
        $this->releaseEndpointBlockedPendingEvents(
            self::endpointBlockedMaxAttempts(
                self::RETRY_BASE_DELAY_SECONDS,
                (float)Configuration::get('RETRY_BACKOFF_MULTIPLIER') ?: 2.0
            )
        );
    }

    /**
     * Run one retention pass (#2604)
     *
     * Deletes terminal rows - and only terminal rows - so the outbox cannot
     * grow without bound. Bounded to
     * RETENTION_DELETE_BATCH_SIZE * RETENTION_MAX_BATCHES_PER_PASS rows, so a
     * table that is already huge drains over several passes instead of locking
     * the shop out in one statement.
     *
     * Normally rate-limited to one pass per RETENTION_MIN_INTERVAL_SECONDS.
     * A pass that spends its whole budget rewinds that stamp, so the next cron
     * tick continues immediately instead of waiting the hour. Without that a
     * legacy table of millions of rows would need weeks, and a busy shop would
     * outrun retention forever. The rewind cannot become a hot loop: it happens
     * only when the pass really deleted a full budget, which means there was
     * that much history to delete.
     *
     * Two cron invocations can both pass the interval gate and both stamp. The
     * result is duplicated work, never a wrong answer: every statement here is
     * a bounded DELETE whose predicate the other run re-evaluates.
     *
     * @param bool $force Skip the interval gate (operator-triggered pass)
     * @return array Report: ran, deleted_delivered, deleted_failed,
     *               deleted_over_cap, rows, rows_capped, backlog_over_cap,
     *               drain_pending
     */
    public function runRetention($force = false)
    {
        $now = time();
        $lastRunAt = (int)Configuration::get(self::RETENTION_LAST_RUN_CONFIG_KEY);

        if (!self::shouldRunRetention($lastRunAt, $now, $force)) {
            return [
                'ran' => false,
                'deleted_delivered' => 0,
                'deleted_failed' => 0,
                'deleted_over_cap' => 0,
                'rows' => null,
                'rows_capped' => false,
                'backlog_over_cap' => false,
                'drain_pending' => false,
            ];
        }

        // Stamped before the deletes, not after. A pass that dies half way
        // then waits for the next interval instead of being retried on every
        // cron tick, which on a broken table would be a hot loop.
        Configuration::updateGlobalValue(self::RETENTION_LAST_RUN_CONFIG_KEY, $now);

        $fullBudget = self::retentionBudgetPerPass();
        $budget = $fullBudget;

        $deliveredDays = self::resolveRetentionDeliveredDays(
            Configuration::get(self::RETENTION_DAYS_CONFIG_KEY)
        );

        $delivered = $this->deleteTerminalRows('delivered', $deliveredDays, $budget);
        $budget -= $delivered['deleted'];

        $failed = $this->deleteTerminalRows('failed', self::RETENTION_FAILED_DAYS, $budget);
        $budget -= $failed['deleted'];

        $cap = $this->enforceRowCap($budget);

        $totalDeleted = $delivered['deleted'] + $failed['deleted'] + $cap['deleted'];
        $drainPending = $totalDeleted >= $fullBudget;

        if ($drainPending) {
            // Rewind past the gate so the next tick picks up where this one
            // stopped. Written after the deletes succeeded, so a pass that
            // throws leaves the pre-delete stamp standing.
            Configuration::updateGlobalValue(
                self::RETENTION_LAST_RUN_CONFIG_KEY,
                $now - self::RETENTION_MIN_INTERVAL_SECONDS
            );
        }

        return [
            'ran' => true,
            'deleted_delivered' => $delivered['deleted'],
            'deleted_failed' => $failed['deleted'],
            'deleted_over_cap' => $cap['deleted'],
            'rows' => $cap['rows'],
            'rows_capped' => $cap['rows_capped'],
            'backlog_over_cap' => $cap['backlog_over_cap'],
            'drain_pending' => $drainPending,
        ];
    }

    /**
     * Rows one retention pass may delete
     *
     * @return int
     */
    public static function retentionBudgetPerPass()
    {
        return self::RETENTION_DELETE_BATCH_SIZE * self::RETENTION_MAX_BATCHES_PER_PASS;
    }
    /**
     * Should a retention pass run now?
     *
     * Pure so the interval rule can be tested without a database.
     *
     * @param int $lastRunAt Unix timestamp of the previous pass, 0 if never
     * @param int $now Unix timestamp of now
     * @param bool $force
     * @return bool
     */
    public static function shouldRunRetention($lastRunAt, $now, $force = false)
    {
        if ($force) {
            return true;
        }

        $lastRunAt = (int)$lastRunAt;
        $now = (int)$now;

        if ($lastRunAt <= 0) {
            return true;
        }

        // A clock that jumped backwards must not park retention in the future.
        if ($lastRunAt > $now) {
            return true;
        }

        return ($now - $lastRunAt) >= self::RETENTION_MIN_INTERVAL_SECONDS;
    }

    /**
     * Resolve the delivered-row retention horizon from operator configuration
     *
     * Pure. An unset, non-numeric, zero or negative value falls back to the
     * default rather than to "delete immediately" - retention must never be
     * able to eat today's history because a setting went missing.
     *
     * @param mixed $raw Raw Configuration value
     * @return int Days
     */
    public static function resolveRetentionDeliveredDays($raw)
    {
        $days = (int)$raw;

        if ($days < self::RETENTION_DELIVERED_DAYS_MIN) {
            return self::DEFAULT_RETENTION_DELIVERED_DAYS;
        }

        if ($days > self::RETENTION_DELIVERED_DAYS_MAX) {
            return self::RETENTION_DELIVERED_DAYS_MAX;
        }

        return $days;
    }

    /**
     * Resolve the per-run wall-clock budget from operator configuration (#2652)
     *
     * Pure. An unset, non-numeric or out-of-range value falls back to the
     * default rather than to zero: a zero budget would stop the run before its
     * first delivery and the queue would never drain, which is a worse failure
     * than the one the budget removes. Deliberately no `empty()` anywhere here
     * - a stored "0" is falsy in PHP and would be indistinguishable from an
     * unset key, so the coercion is done on the integer and its range.
     *
     * @param mixed $raw Raw Configuration value
     * @return int Seconds
     */
    public static function resolveRunBudgetSeconds($raw)
    {
        $seconds = (int)$raw;

        if ($seconds < self::RUN_BUDGET_SECONDS_MIN) {
            return self::DEFAULT_RUN_BUDGET_SECONDS;
        }

        if ($seconds > self::RUN_BUDGET_SECONDS_MAX) {
            return self::RUN_BUDGET_SECONDS_MAX;
        }

        return $seconds;
    }

    /**
     * Whether one more delivery can start without crossing the run budget
     *
     * Pure. Asks whether the *worst case* of the next delivery fits, not
     * whether the budget has already been passed: checking afterwards is what
     * lets a run that was inside the budget at second 119 leave at second 129.
     *
     * The first delivery of a pass is always allowed, and that guarantee is
     * keyed to the DELIVERY COUNT, not to elapsed time (#2660 review). It used
     * to read `$elapsedSeconds <= 0`, which is never true in a real pass:
     * DeliveryRunner takes its clock before requeueStaleProcessingRows() and
     * claimBatchDueForDelivery(), both of which are paid out of the same
     * budget. On a large outbox those two statements alone can outlast a short
     * budget, so the very first iteration refused, the whole claimed batch was
     * requeued, and every following pass did the same - a queue that never
     * drains, behind one warn line. The unit test asserted the guarantee with a
     * literal 0, so it passed while the property was absent.
     *
     * A run that delivered nothing at all makes no progress, so it is allowed
     * to overshoot by at most one delivery. minimumStaleThresholdMinutes()
     * already sizes the lease floor for exactly that overshoot.
     *
     * @param float $elapsedSeconds Wall clock since the pass started
     * @param int $budgetSeconds Resolved budget
     * @param int $worstCaseDeliverySeconds Longest one delivery can take
     * @param int $deliveriesAttempted How many deliveries this pass already started
     * @return bool
     */
    public static function hasBudgetForAnotherDelivery(
        $elapsedSeconds,
        $budgetSeconds,
        $worstCaseDeliverySeconds,
        $deliveriesAttempted = 1
    ) {
        // Defaults to 1 ("not the first"), so a caller that forgets to pass the
        // counter gets the strict check rather than a free pass every loop.
        if ((int)$deliveriesAttempted <= 0) {
            return true;
        }

        return ((float)$elapsedSeconds + (int)$worstCaseDeliverySeconds) <= (int)$budgetSeconds;
    }

    /**
     * Lowest stale threshold that cannot steal live work (#2652)
     *
     * Pure. A run stops before its budget and may overshoot by at most one
     * delivery, so budget + one delivery is the longest a *live* run can hold
     * a lease. Anything at or below that would let a peer reclaim rows another
     * process is still delivering, and both would send the same event - which
     * is exactly what lowering the threshold, on its own, would have caused.
     * The safety margin on top absorbs clock skew between PHP and MySQL.
     *
     * @param int $budgetSeconds Resolved run budget
     * @param int|null $worstCaseDeliverySeconds Longest one delivery can take
     * @return int Minutes
     */
    public static function minimumStaleThresholdMinutes($budgetSeconds, $worstCaseDeliverySeconds = null)
    {
        if ($worstCaseDeliverySeconds === null) {
            $worstCaseDeliverySeconds = self::worstCaseDeliverySeconds();
        }

        $seconds = (int)$budgetSeconds
            + (int)$worstCaseDeliverySeconds
            + self::STALE_THRESHOLD_SAFETY_SECONDS;

        return (int)ceil($seconds / 60);
    }

    /**
     * The stale-lease threshold to SUGGEST for a given run budget (#2660 review)
     *
     * Pure. The built-in default is 5 minutes and the floor rises with the
     * budget, so at a 280 s budget the floor is 6 - and a form advertising
     * "default: 5" beside a minimum of 6 offers a value it would then refuse.
     * The suggestion is the built-in default or the floor, whichever is larger.
     *
     * @param int $budgetSeconds Resolved run budget
     * @return int Minutes
     */
    public static function defaultStaleThresholdMinutes($budgetSeconds)
    {
        return max(
            self::DEFAULT_STALE_PROCESSING_THRESHOLD_MINUTES,
            self::minimumStaleThresholdMinutes($budgetSeconds)
        );
    }

    /**
     * Resolve the stale-lease threshold from operator configuration (#2652)
     *
     * Pure. Clamped up to the liveness floor rather than rejected: an operator
     * who types 1 minute gets the shortest safe value and a working outbox,
     * not a setting that silently double-delivers. The form refuses such a
     * value with an explanation - this is the read-side backstop for a value
     * that reached the table some other way, and for a floor that moved
     * because the budget was raised afterwards.
     *
     * @param mixed $raw Raw Configuration value
     * @param int $floorMinutes Result of minimumStaleThresholdMinutes()
     * @return int Minutes
     */
    public static function resolveStaleThresholdMinutes($raw, $floorMinutes)
    {
        $minutes = (int)$raw;

        if ($minutes < 1) {
            $minutes = self::DEFAULT_STALE_PROCESSING_THRESHOLD_MINUTES;
        }

        if ($minutes > self::STALE_PROCESSING_THRESHOLD_MINUTES_MAX) {
            $minutes = self::STALE_PROCESSING_THRESHOLD_MINUTES_MAX;
        }

        return max($minutes, (int)$floorMinutes);
    }

    /**
     * The configured run budget, in seconds.
     *
     * @return int
     */
    public static function readRunBudgetSeconds()
    {
        return self::resolveRunBudgetSeconds(Configuration::get(self::RUN_BUDGET_CONFIG_KEY));
    }

    /**
     * The configured stale-lease threshold, in minutes, never below its floor.
     *
     * @return int
     */
    public static function readStaleThresholdMinutes()
    {
        return self::resolveStaleThresholdMinutes(
            Configuration::get(self::STALE_PROCESSING_THRESHOLD_CONFIG_KEY),
            self::minimumStaleThresholdMinutes(self::readRunBudgetSeconds())
        );
    }

    /**
     * Longest a single delivery can take.
     *
     * Read from WebhookSender so the budget arithmetic and the HTTP timeout
     * cannot drift apart. The fallback covers an unusual load order only.
     *
     * @return int Seconds
     */
    public static function worstCaseDeliverySeconds()
    {
        if (!class_exists('WebhookSender')) {
            $senderPath = dirname(__FILE__) . '/WebhookSender.php';
            if (file_exists($senderPath)) {
                require_once($senderPath);
            }
        }

        if (class_exists('WebhookSender')) {
            return (int)WebhookSender::HTTP_TIMEOUT_SECONDS;
        }

        return 10;
    }

    /**
     * Build one bounded terminal-row DELETE
     *
     * Extracted and public so the one property that matters can be pinned by a
     * test: a retention DELETE can only ever name a terminal status. `pending`
     * is queued work and `processing` is leased by a live cron run, so either
     * being reachable here would lose an event - the exact failure the outbox
     * exists to prevent. The status is matched positively against a two-value
     * whitelist rather than by excluding the live statuses, which is also what
     * makes retention commute with the stale-lease requeue.
     *
     * @param string $tableName Fully prefixed table name
     * @param string $status Either 'delivered' or 'failed'
     * @param int|null $days Age horizon in days, or null for no age predicate
     * @param int $limit Row limit for this statement
     * @return string
     * @throws Exception When the status is not terminal
     */
    public static function buildTerminalDeleteSql($tableName, $status, $days, $limit)
    {
        if ($status !== 'delivered' && $status !== 'failed') {
            throw new Exception('Refusing to prune non-terminal status: ' . $status);
        }

        $ageClause = '';
        if ($days !== null) {
            $ageClause = ' AND `updated_at` < DATE_SUB(NOW(), INTERVAL ' . (int)$days . ' DAY)';
        }

        // Ordered by `updated_at` first: it prunes the oldest first and it is
        // the order the (status, updated_at) index already provides, so the
        // statement needs no sort on a large table. `id` breaks ties, because
        // `updated_at` is not unique and an unordered LIMIT is flagged unsafe
        // by statement-based binlog replication.
        return 'DELETE FROM `' . bqSQL($tableName) . '`
                WHERE `status` = "' . pSQL($status) . '"' . $ageClause . '
                ORDER BY `updated_at` ASC, `id` ASC
                LIMIT ' . (int)$limit;
    }

    /**
     * Delete rows in one terminal status, in bounded batches
     *
     * `updated_at` is the age column for both terminal statuses: a failed row
     * has no `delivered_at`, and using one column lets a single
     * (status, updated_at) index serve both.
     *
     * @param string $status Either 'delivered' or 'failed'
     * @param int|null $days Age horizon, or null to ignore age
     * @param int $budget Maximum rows this call may delete
     * @return array deleted (int), exhausted (bool - ran out of eligible rows)
     */
    private function deleteTerminalRows($status, $days, $budget)
    {
        $deleted = 0;
        $exhausted = false;

        while ($budget > 0) {
            $limit = min(self::RETENTION_DELETE_BATCH_SIZE, $budget);

            Db::getInstance()->execute(
                self::buildTerminalDeleteSql($this->tableName, $status, $days, $limit)
            );
            $affected = (int)Db::getInstance()->Affected_Rows();

            $deleted += $affected;
            $budget -= $affected;

            if ($affected < $limit) {
                $exhausted = true;
                break;
            }
        }

        return ['deleted' => $deleted, 'exhausted' => $exhausted];
    }

    /**
     * Enforce the hard row cap
     *
     * Behaviour at the cap is deliberately not "refuse new events": dropping a
     * hook fire is silent data loss, the exact defect class #2603 closed. It is
     * also not "delete the oldest rows whatever their state": a queued or
     * leased row is work, not history. So the cap deletes the oldest terminal
     * rows and nothing else. If the table is still over the cap once every
     * terminal row is gone, the excess is a genuine undelivered backlog: the
     * pass reports it so the caller can log it, and leaves it alone.
     *
     * Delivered rows go first and failed rows only once no delivered row is
     * left. A failed row is the only record of what broke, so it has to outlive
     * the success history under cap pressure too - a single delete over both
     * statuses ordered by age would prune an old failure before a newer
     * success.
     *
     * @param int $budget Maximum rows this call may delete
     * @return array deleted (int), rows (int, after deletion), rows_capped
     *               (bool - the count stopped at its probe bound),
     *               backlog_over_cap (bool)
     */
    private function enforceRowCap($budget)
    {
        $count = $this->countRowsUpToCapProbe();
        $rows = $count['rows'];

        if ($rows <= self::RETENTION_MAX_ROWS) {
            return [
                'deleted' => 0,
                'rows' => $rows,
                'rows_capped' => $count['capped'],
                'backlog_over_cap' => false,
            ];
        }

        $excess = $rows - self::RETENTION_MAX_ROWS;
        $allowed = min($excess, max(0, (int)$budget));

        $deleted = 0;
        $budgetLimited = false;

        foreach (['delivered', 'failed'] as $status) {
            if ($allowed <= 0) {
                $budgetLimited = true;
                break;
            }

            $pass = $this->deleteTerminalRows($status, null, $allowed);
            $deleted += $pass['deleted'];
            $allowed -= $pass['deleted'];

            if (!$pass['exhausted']) {
                $budgetLimited = true;
                break;
            }
        }

        $exhausted = !$budgetLimited;

        $rowsAfter = $rows - $deleted;
        $stillOver = $rowsAfter > self::RETENTION_MAX_ROWS;

        // Only a table that has run out of terminal rows and is still over the
        // cap is a real backlog. A budget-limited pass is just partway through
        // and the next tick continues. When the age deletes consumed the whole
        // budget nothing above ran at all, so ask the table directly rather
        // than reporting "no backlog" on no evidence.
        if ($stillOver && $budget <= 0) {
            $exhausted = !$this->hasTerminalRows();
        }

        return [
            'deleted' => $deleted,
            'rows' => $rowsAfter,
            'rows_capped' => $count['capped'],
            'backlog_over_cap' => ($stillOver && $exhausted),
        ];
    }

    /**
     * Is any terminal row left?
     *
     * A one-row existence probe, not a count: the caller only needs to tell
     * "still prunable history" from "genuine undelivered backlog".
     *
     * @return bool
     */
    private function hasTerminalRows()
    {
        $row = Db::getInstance()->getRow(
            'SELECT `id` FROM `' . $this->tableName . '`
             WHERE `status` IN ("delivered", "failed")
             LIMIT 1'
        );

        return is_array($row) && isset($row['id']);
    }

    /**
     * Count rows, stopping once the answer cannot change a retention decision
     *
     * An exact COUNT(*) on InnoDB is a full index scan, and this runs on every
     * pass and every admin page load - on exactly the multi-million-row tables
     * this change exists for. Nothing here needs the exact number past the cap
     * plus one pass's budget, so the scan stops there and the caller is told
     * the figure is a floor.
     *
     * @return array rows (int), capped (bool)
     */
    private function countRowsUpToCapProbe()
    {
        $bound = self::RETENTION_MAX_ROWS + self::retentionBudgetPerPass() + 1;
        $rows = $this->countRowsUpTo($bound);

        return ['rows' => $rows, 'capped' => $rows >= $bound];
    }
    /**
     * Count rows, up to a bound
     *
     * An exact COUNT(*) on InnoDB is a full index scan, and retention asks for
     * a count on every pass while the admin page asks on every load - on
     * exactly the multi-million-row tables this change exists for. The derived
     * table with a LIMIT lets InnoDB stop scanning at the bound, so the cost
     * does not grow with the table. A caller past the bound is told the figure
     * is a floor rather than being handed a wrong exact number.
     *
     * @param int $limit Stop counting here
     * @return int
     */
    public function countRowsUpTo($limit)
    {
        $result = Db::getInstance()->getRow(
            'SELECT COUNT(*) as count FROM
             (SELECT 1 FROM `' . $this->tableName . '` LIMIT ' . (int)$limit . ') probe'
        );

        return (int)(is_array($result) && isset($result['count']) ? $result['count'] : 0);
    }

    /**
     * Get statistics for diagnostics
     *
     * @return array Statistics
     */
    public function getStatistics()
    {
        $stats = [];
        $db = Db::getInstance();

        try {
            // Pending count
            $sql = 'SELECT COUNT(*) as count FROM `' . $this->tableName . '` WHERE `status` = "pending"';
            $result = $db->getRow($sql);
            $stats['pending'] = (int)(is_array($result) && isset($result['count']) ? $result['count'] : 0);

            // Processing count
            $sql = 'SELECT COUNT(*) as count FROM `' . $this->tableName . '` WHERE `status` = "processing"';
            $result = $db->getRow($sql);
            $stats['processing'] = (int)(is_array($result) && isset($result['count']) ? $result['count'] : 0);

            // Failed count
            $sql = 'SELECT COUNT(*) as count FROM `' . $this->tableName . '` WHERE `status` = "failed"';
            $result = $db->getRow($sql);
            $stats['failed'] = (int)(is_array($result) && isset($result['count']) ? $result['count'] : 0);

            // Delivered count (last 24h)
            $sql = 'SELECT COUNT(*) as count FROM `' . $this->tableName . '`
                    WHERE `status` = "delivered"
                    AND `delivered_at` >= DATE_SUB(NOW(), INTERVAL ' . (int)self::STATISTICS_DELIVERED_WINDOW_HOURS . ' HOUR)';
            $result = $db->getRow($sql);
            $stats['delivered_24h'] = (int)(is_array($result) && isset($result['count']) ? $result['count'] : 0);

            // Last delivery time
            $sql = 'SELECT MAX(`delivered_at`) as last_delivery FROM `' . $this->tableName . '`
                    WHERE `status` = "delivered"';
            $result = $db->getRow($sql);
            $stats['last_delivery'] = (is_array($result) && isset($result['last_delivery'])) ? $result['last_delivery'] : null;

            // Last error message
            $sql = 'SELECT `last_error` FROM `' . $this->tableName . '`
                    WHERE `status` = "failed"
                    ORDER BY `updated_at` DESC
                    LIMIT 1';
            $result = $db->getRow($sql);
            $stats['last_error'] = (is_array($result) && isset($result['last_error'])) ? $result['last_error'] : null;

            // Retention state, so the cap and the horizon are visible rather
            // than being facts only the cron knows (#2604).
            $totalBound = self::RETENTION_MAX_ROWS + self::retentionBudgetPerPass() + 1;
            $stats['total'] = $this->countRowsUpTo($totalBound);
            $stats['total_capped'] = $stats['total'] >= $totalBound;
            $stats['max_rows'] = self::RETENTION_MAX_ROWS;
            $stats['over_cap'] = $stats['total'] > self::RETENTION_MAX_ROWS;
            $stats['retention_delivered_days'] = self::resolveRetentionDeliveredDays(
                Configuration::get(self::RETENTION_DAYS_CONFIG_KEY)
            );
            $stats['retention_failed_days'] = self::RETENTION_FAILED_DAYS;
        } catch (Exception $e) {
            // Log error but return partial stats
            PrestaShopLogger::addLog(
                'OpenLinker: Error in getStatistics: ' . $e->getMessage() . ' | SQL Error: ' . $db->getMsgError(),
                3,
                null,
                'Module',
                null
            );
            
            // Return defaults if query failed
            if (empty($stats)) {
                $stats = [
                    'pending' => 0,
                    'processing' => 0,
                    'failed' => 0,
                    'delivered_24h' => 0,
                    'last_delivery' => null,
                    'last_error' => 'Error retrieving statistics: ' . $e->getMessage(),
                    'total' => 0,
                    'total_capped' => false,
                    'max_rows' => self::RETENTION_MAX_ROWS,
                    'over_cap' => false,
                    'retention_delivered_days' => self::DEFAULT_RETENTION_DELIVERED_DAYS,
                    'retention_failed_days' => self::RETENTION_FAILED_DAYS,
                ];
            }
        }

        // A query that failed part way through must not leave the admin
        // template reading a key that was never set.
        return array_merge(self::defaultStatistics(), $stats);
    }

    /**
     * Statistics defaults
     *
     * @return array
     */
    private static function defaultStatistics()
    {
        return [
            'pending' => 0,
            'processing' => 0,
            'failed' => 0,
            'delivered_24h' => 0,
            'last_delivery' => null,
            'last_error' => null,
            'total' => 0,
            'total_capped' => false,
            'max_rows' => self::RETENTION_MAX_ROWS,
            'over_cap' => false,
            'retention_delivered_days' => self::DEFAULT_RETENTION_DELIVERED_DAYS,
            'retention_failed_days' => self::RETENTION_FAILED_DAYS,
        ];
    }
}
