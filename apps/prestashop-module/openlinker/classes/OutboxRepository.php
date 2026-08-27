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
    // Stale row recovery threshold (events stuck in processing longer than this are requeued)
    const STALE_PROCESSING_THRESHOLD_MINUTES = 15;

    // Retry backoff constants
    const RETRY_BASE_DELAY_SECONDS = 60; // 1 minute
    const RETRY_MAX_DELAY_SECONDS = 21600; // 6 hours

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
     * Recovers rows stuck in 'processing' status (e.g., cron crashed mid-run).
     * Called at start of cron execution.
     *
     * @return int Number of rows requeued
     */
    public function requeueStaleProcessingRows()
    {
        $sql = 'UPDATE `' . $this->tableName . '`
                SET `status` = "pending",
                    `processing_owner` = NULL,
                    `processing_started_at` = NULL,
                    `last_error` = "Stale processing row requeued (cron crashed)",
                    `updated_at` = NOW()
                WHERE `status` = "processing"
                AND `processing_started_at` < DATE_SUB(NOW(), INTERVAL ' . (int)self::STALE_PROCESSING_THRESHOLD_MINUTES . ' MINUTE)';

        Db::getInstance()->execute($sql);
        return (int)Db::getInstance()->Affected_Rows();
    }

    /**
     * Requeue all processing rows
     *
     * Requeues all rows in 'processing' status. Used for manual delivery
     * to ensure any stuck events are immediately available.
     *
     * @return int Number of rows requeued
     */
    public function requeueAllProcessingRows()
    {
        $sql = 'UPDATE `' . $this->tableName . '`
                SET `status` = "pending",
                    `processing_owner` = NULL,
                    `processing_started_at` = NULL,
                    `last_error` = "Requeued for manual delivery",
                    `updated_at` = NOW()
                WHERE `status` = "processing"';

        Db::getInstance()->execute($sql);
        return (int)Db::getInstance()->Affected_Rows();
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

        return Db::getInstance()->execute($sql);
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
     * @return bool Success
     */
    public function scheduleRetry($outboxId, $attemptNumber, $errorMessage)
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

        // Calculate exponential backoff
        $delay = $baseDelay * pow($backoffMultiplier, $attemptNumber);
        $delay = min($delay, $maxDelay); // Cap at max delay

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

        return Db::getInstance()->execute($sql);
    }

    /**
     * Run one retention pass (#2604)
     *
     * Deletes terminal rows - and only terminal rows - so the outbox cannot
     * grow without bound. Rate-limited to one pass per
     * RETENTION_MIN_INTERVAL_SECONDS, and bounded to
     * RETENTION_DELETE_BATCH_SIZE * RETENTION_MAX_BATCHES_PER_PASS rows, so a
     * table that is already huge drains over several passes instead of locking
     * the shop out in one statement.
     *
     * @param bool $force Skip the interval gate (operator-triggered pass)
     * @return array Report: ran, deleted_delivered, deleted_failed,
     *               deleted_over_cap, rows, backlog_over_cap
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
                'backlog_over_cap' => false,
            ];
        }

        // Stamped before the deletes, not after. A pass that dies half way
        // then waits for the next interval instead of being retried on every
        // cron tick, which on a broken table would be a hot loop.
        Configuration::updateValue(self::RETENTION_LAST_RUN_CONFIG_KEY, $now);

        $budget = self::RETENTION_DELETE_BATCH_SIZE * self::RETENTION_MAX_BATCHES_PER_PASS;

        $deliveredDays = self::resolveRetentionDeliveredDays(
            Configuration::get(self::RETENTION_DAYS_CONFIG_KEY)
        );

        $delivered = $this->deleteTerminalRowsOlderThan('delivered', $deliveredDays, $budget);
        $budget -= $delivered['deleted'];

        $failed = $this->deleteTerminalRowsOlderThan('failed', self::RETENTION_FAILED_DAYS, $budget);
        $budget -= $failed['deleted'];

        $cap = $this->enforceRowCap($budget);

        return [
            'ran' => true,
            'deleted_delivered' => $delivered['deleted'],
            'deleted_failed' => $failed['deleted'],
            'deleted_over_cap' => $cap['deleted'],
            'rows' => $cap['rows'],
            'backlog_over_cap' => $cap['backlog_over_cap'],
        ];
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
     * Delete rows in one terminal status older than a horizon
     *
     * The status is matched explicitly, so no call can widen the delete onto a
     * queued or leased row. `updated_at` is the age column for both terminal
     * statuses: a failed row has no `delivered_at`, and using one column lets a
     * single (status, updated_at) index serve both.
     *
     * @param string $status Either 'delivered' or 'failed'
     * @param int $days Retention horizon in days
     * @param int $budget Maximum rows this call may delete
     * @return array deleted (int), exhausted (bool - ran out of eligible rows)
     */
    private function deleteTerminalRowsOlderThan($status, $days, $budget)
    {
        if ($status !== 'delivered' && $status !== 'failed') {
            throw new Exception('Refusing to prune non-terminal status: ' . $status);
        }

        $deleted = 0;
        $exhausted = false;

        while ($budget > 0) {
            $limit = min(self::RETENTION_DELETE_BATCH_SIZE, $budget);

            // Ordered by `updated_at`, not by `id`: it prunes the oldest first
            // and it is the order the (status, updated_at) index already
            // provides, so the statement needs no sort on a large table.
            $sql = 'DELETE FROM `' . $this->tableName . '`
                    WHERE `status` = "' . pSQL($status) . '"
                    AND `updated_at` < DATE_SUB(NOW(), INTERVAL ' . (int)$days . ' DAY)
                    ORDER BY `updated_at` ASC
                    LIMIT ' . (int)$limit;

            Db::getInstance()->execute($sql);
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
     * @param int $budget Maximum rows this call may delete
     * @return array deleted (int), rows (int, after deletion), backlog_over_cap (bool)
     */
    private function enforceRowCap($budget)
    {
        $rows = $this->countRows();

        if ($rows <= self::RETENTION_MAX_ROWS) {
            return ['deleted' => 0, 'rows' => $rows, 'backlog_over_cap' => false];
        }

        $excess = $rows - self::RETENTION_MAX_ROWS;
        $allowed = min($excess, max(0, (int)$budget));

        $deleted = 0;
        $exhausted = false;

        while ($allowed > 0) {
            $limit = min(self::RETENTION_DELETE_BATCH_SIZE, $allowed);

            $sql = 'DELETE FROM `' . $this->tableName . '`
                    WHERE `status` IN ("delivered", "failed")
                    ORDER BY `id` ASC
                    LIMIT ' . (int)$limit;

            Db::getInstance()->execute($sql);
            $affected = (int)Db::getInstance()->Affected_Rows();

            $deleted += $affected;
            $allowed -= $affected;

            if ($affected < $limit) {
                $exhausted = true;
                break;
            }
        }

        $rowsAfter = $rows - $deleted;

        return [
            'deleted' => $deleted,
            'rows' => $rowsAfter,
            // Only a table that has run out of terminal rows and is still over
            // the cap is a real backlog. A budget-limited pass is just partway
            // through and the next pass continues.
            'backlog_over_cap' => ($rowsAfter > self::RETENTION_MAX_ROWS && $exhausted),
        ];
    }

    /**
     * Count all rows in the outbox
     *
     * @return int
     */
    public function countRows()
    {
        $result = Db::getInstance()->getRow(
            'SELECT COUNT(*) as count FROM `' . $this->tableName . '`'
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
            $stats['total'] = $this->countRows();
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
            'max_rows' => self::RETENTION_MAX_ROWS,
            'over_cap' => false,
            'retention_delivered_days' => self::DEFAULT_RETENTION_DELIVERED_DAYS,
            'retention_failed_days' => self::RETENTION_FAILED_DAYS,
        ];
    }
}
