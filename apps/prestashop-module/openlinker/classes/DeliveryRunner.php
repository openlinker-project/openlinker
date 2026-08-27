<?php
/**
 * Delivery Runner
 *
 * One pass of outbox delivery, callable without an HTTP request (#2618).
 *
 * The delivery loop used to live inside the cron front controller, which meant
 * the only way to trigger it was an authenticated HTTP call with a token. That
 * does not work on the file-based cron model several Polish hosts use
 * (home.pl, AZ.pl): the schedule is the file's name, and no arguments can be
 * passed to it. Moving the loop here lets a plain PHP file run delivery
 * in-process, with no URL and no credential involved.
 *
 * It also records when a pass last actually ran. Before this, a shop whose cron
 * never fired looked exactly like a shop with nothing to deliver.
 *
 * @module prestashop-module/classes
 * @see {@link OutboxRepository} for claiming and state transitions
 * @see {@link WebhookSender} for the HTTP delivery itself
 */

class DeliveryRunner
{
    /** Timestamp of the last completed pass, however it was triggered. */
    const LAST_RUN_CONFIG_KEY = 'OPENLINKER_CRON_LAST_RUN_AT';

    /** How the last pass was triggered, so the panel can name it. */
    const LAST_RUN_SOURCE_CONFIG_KEY = 'OPENLINKER_CRON_LAST_RUN_SOURCE';

    /**
     * Run one delivery pass.
     *
     * @param string $source Free-text trigger name for the panel ('cron file',
     *                       'http', 'manual').
     * @return array Statistics for the caller to render or return as JSON.
     * @throws Exception when the pass could not be completed.
     */
    public static function run($source = 'unknown')
    {
        $classesDir = dirname(__FILE__) . '/';
        foreach (['EventIdGenerator', 'OutboxEvent', 'OutboxRepository', 'WebhookSender'] as $class) {
            if (!class_exists($class)) {
                require_once($classesDir . $class . '.php');
            }
        }

        $repository = new OutboxRepository();
        $sender = new WebhookSender();
        $runId = uniqid('cron_', true);

        try {
            $requeued = $repository->requeueStaleProcessingRows();

            $batchSize = (int) Configuration::get('BATCH_SIZE') ?: 50;
            $events = $repository->claimBatchDueForDelivery($batchSize, $runId);

            $delivered = 0;
            $failed = 0;

            foreach ($events as $event) {
                if (self::deliverOne($repository, $sender, $event)) {
                    $delivered++;
                } else {
                    $failed++;
                }
            }

            // An idle queue is exactly when retention should run, so the pass
            // is the same shape whether or not there was work.
            $retention = self::runRetention($repository);

            self::recordRun($source);

            return [
                'processed' => count($events),
                'delivered' => $delivered,
                'failed' => $failed,
                'requeued' => $requeued,
                'retention' => $retention,
            ];
        } catch (Exception $e) {
            // Release whatever this pass claimed, or those rows sit in
            // `processing` until the stale sweep reaches them.
            try {
                $repository->requeueEventsByRunId($runId, 'Cron delivery failed: ' . $e->getMessage());
            } catch (Exception $cleanupError) {
                PrestaShopLogger::addLog(
                    'OpenLinker: Failed to cleanup events after cron error: '
                        . $cleanupError->getMessage(),
                    3,
                    null,
                    'Module',
                    null
                );
            }

            throw $e;
        }
    }

    /**
     * Deliver one event, applying the retry ladder on failure.
     *
     * @param OutboxRepository $repository
     * @param WebhookSender    $sender
     * @param OutboxEvent      $event
     * @return bool true when delivered.
     */
    private static function deliverOne($repository, $sender, $event)
    {
        try {
            if ($sender->sendEvent($event)) {
                $repository->markDelivered($event->id);

                return true;
            }

            // sendEvent throws on failure, so this is defensive only.
            $repository->scheduleRetry($event->id, $event->attempts, 'Webhook sender returned false');

            return false;
        } catch (Exception $e) {
            $errorMessage = WebhookSender::getErrorMessage($e);
            $maxAttempts = (int) Configuration::get('MAX_RETRY_ATTEMPTS') ?: 25;

            if ($event->attempts >= $maxAttempts) {
                $repository->markFailed($event->id, $errorMessage);
            } else {
                $repository->scheduleRetry($event->id, $event->attempts, $errorMessage);
            }

            return false;
        }
    }

    /**
     * Record that a pass completed.
     *
     * Never fatal: the events were delivered either way, and losing the
     * bookkeeping must not turn a good pass into a failure.
     *
     * @param string $source
     * @return void
     */
    private static function recordRun($source)
    {
        try {
            Configuration::updateGlobalValue(self::LAST_RUN_CONFIG_KEY, date('Y-m-d H:i:s'));
            Configuration::updateGlobalValue(self::LAST_RUN_SOURCE_CONFIG_KEY, (string) $source);
        } catch (Exception $e) {
            PrestaShopLogger::addLog(
                'OpenLinker: could not record the delivery run time: ' . $e->getMessage(),
                2,
                null,
                'Module',
                null
            );
        }
    }

    /**
     * Run one outbox retention pass (#2604)
     *
     * Never fatal: retention is housekeeping, and a shop whose outbox cannot
     * be pruned must still deliver its events.
     *
     * @param OutboxRepository $repository
     * @return array Retention report.
     */
    private static function runRetention($repository)
    {
        try {
            $report = $repository->runRetention();

            if (!empty($report['backlog_over_cap'])) {
                // Every terminal row is gone and the table is still over the
                // cap, so the excess is undelivered work. Retention will not
                // touch it - an operator has to.
                $rows = (int) $report['rows'];
                PrestaShopLogger::addLog(
                    'OpenLinker: outbox is over its row cap ('
                    . (empty($report['rows_capped']) ? (string) $rows : $rows . '+')
                    . ' rows) with no prunable history left. The excess is undelivered'
                    . ' events - check webhook delivery.',
                    3,
                    null,
                    'Module',
                    null
                );
            }

            return $report;
        } catch (Throwable $e) {
            PrestaShopLogger::addLog(
                'OpenLinker: outbox retention failed: ' . $e->getMessage(),
                2,
                null,
                'Module',
                null
            );

            return ['ran' => false, 'error' => $e->getMessage()];
        }
    }
}
