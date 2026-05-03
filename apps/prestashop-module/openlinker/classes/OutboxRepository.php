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

    private $tableName;

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

        // Set defaults
        $now = date('Y-m-d H:i:s');
        $occurredAt = $eventData['occurredAt'] ?? $now;

        // Use INSERT IGNORE to handle duplicate event IDs gracefully
        // If the same event is enqueued multiple times within the same time window
        // (e.g., hook fires multiple times rapidly), only the first one will be inserted.
        // This works in conjunction with deterministic event IDs from EventIdGenerator.
        $sql = 'INSERT IGNORE INTO `' . $this->tableName . '` (
            `event_id`,
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

        if (!Db::getInstance()->execute($sql)) {
            throw new Exception('Failed to enqueue event: ' . Db::getInstance()->getMsgError());
        }

        // Get the inserted ID, or the existing ID if duplicate was ignored
        $insertId = (int)Db::getInstance()->Insert_ID();
        
        // If INSERT IGNORE skipped a duplicate (insertId = 0), fetch the existing record ID
        // This ensures we return a valid ID even when a duplicate was prevented
        if ($insertId === 0) {
            $existingSql = 'SELECT `id` FROM `' . $this->tableName . '`
                           WHERE `event_id` = "' . pSQL($eventData['eventId']) . '"
                           LIMIT 1';
            $existingRow = Db::getInstance()->getRow($existingSql);
            if ($existingRow && isset($existingRow['id'])) {
                $insertId = (int)$existingRow['id'];
            }
        }

        return $insertId;
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
        $sql = 'UPDATE `' . $this->tableName . '`
                SET `status` = "processing",
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
        $sql = 'UPDATE `' . $this->tableName . '`
                SET `status` = "delivered",
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

        $sql = 'UPDATE `' . $this->tableName . '`
                SET `status` = "failed",
                    `processing_owner` = NULL,
                    `processing_started_at` = NULL,
                    `last_error` = "' . pSQL($truncatedError) . '",
                    `updated_at` = NOW()
                WHERE `id` = ' . (int)$outboxId;

        return Db::getInstance()->execute($sql);
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
                ];
            }
        }

        return $stats;
    }
}
