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
        foreach (['EventIdGenerator', 'OutboxEvent', 'OutboxRepository', 'WebhookSender', 'OutboxDrainer'] as $class) {
            if (!class_exists($class)) {
                require_once($classesDir . $class . '.php');
            }
        }

        $repository = new OutboxRepository();
        $sender = new WebhookSender();
        $runId = uniqid('cron_', true);

        try {
            // Wall clock for this pass (#2652). Taken before the sweep and the
            // claim, because those are paid out of the same host process limit
            // the budget exists to stay under.
            $startedAt = microtime(true);
            $budgetSeconds = OutboxRepository::readRunBudgetSeconds();
            $worstCaseDelivery = OutboxRepository::worstCaseDeliverySeconds();

            // Passing this run's own id is what stops the sweep reclaiming a
            // lease it is about to take itself.
            $requeued = $repository->requeueStaleProcessingRows($runId);

            $batchSize = (int) Configuration::get('BATCH_SIZE') ?: 50;
            $events = $repository->claimBatchDueForDelivery($batchSize, $runId);

            $delivered = 0;
            $failed = 0;
            $attempted = 0;
            $budgetExhausted = false;
            $maxAttempts = (int) Configuration::get('MAX_RETRY_ATTEMPTS') ?: 25;

            foreach ($events as $event) {
                if (!OutboxRepository::hasBudgetForAnotherDelivery(
                    microtime(true) - $startedAt,
                    $budgetSeconds,
                    $worstCaseDelivery,
                    $attempted
                )) {
                    $budgetExhausted = true;
                    break;
                }

                $attempted++;

                if (OutboxDrainer::deliverOne($repository, $sender, $event, $maxAttempts)) {
                    $delivered++;
                } else {
                    $failed++;
                }
            }

            // Everything still `processing` under this run is a row the budget
            // stopped us reaching. Releasing it here is what makes the stop
            // clean: it goes back to `pending` for the next pass instead of
            // waiting out the stale threshold.
            $skipped = 0;
            if ($budgetExhausted) {
                $skipped = $repository->requeueEventsByRunId(
                    $runId,
                    'Run budget of ' . (int) $budgetSeconds . 's reached; requeued for the next run'
                );
                self::warnBudgetExhausted($skipped, $budgetSeconds, $source);
            }

            // An idle queue is exactly when retention should run, so the pass
            // is the same shape whether or not there was work. Skipped when the
            // budget is gone: retention costs time out of the same process
            // limit, and delivery is what the budget is protecting.
            $retention = $budgetExhausted
                ? ['ran' => false, 'reason' => 'run budget reached']
                : self::runRetention($repository);

            self::recordRun($source);

            return [
                'processed' => $attempted,
                'delivered' => $delivered,
                'failed' => $failed,
                'requeued' => $requeued,
                'skipped' => $skipped,
                'budget_exhausted' => $budgetExhausted,
                'budget_seconds' => $budgetSeconds,
                'retention' => $retention,
            ];
        } catch (Throwable $e) {
            // Throwable, not Exception: a TypeError in the delivery loop is an
            // Error, and it would otherwise skip the requeue below and strand
            // every row this pass claimed in `processing`.
            //
            // Release whatever this pass claimed, or those rows sit in
            // `processing` until the stale sweep reaches them.
            try {
                $repository->requeueEventsByRunId($runId, 'Cron delivery failed: ' . $e->getMessage());
            } catch (Throwable $cleanupError) {
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
     * Surface a budget stop.
     *
     * A run that quietly delivers half its queue and returns looks identical
     * to one with half as much work, so the stop is logged rather than
     * swallowed. It is a warning, not an error: nothing was lost, the rows are
     * `pending` again and the next pass takes them. It only becomes an
     * operator problem if it repeats, which is what a log lets them see.
     *
     * @param int $skipped Rows released back to pending
     * @param int $budgetSeconds Budget that was reached
     * @param string $source Trigger name
     * @return void
     */
    private static function warnBudgetExhausted($skipped, $budgetSeconds, $source)
    {
        try {
            PrestaShopLogger::addLog(
                'OpenLinker: delivery pass (' . (string) $source . ') stopped at its '
                . (int) $budgetSeconds . 's budget with ' . (int) $skipped
                . ' event(s) left queued for the next run. If this repeats every run,'
                . ' the queue is growing faster than delivery drains it - check the'
                . ' cron interval and webhook response times.',
                2,
                null,
                'Module',
                null
            );
        } catch (Throwable $e) {
            // Logging must never turn a clean stop into a failed pass.
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
        } catch (Throwable $e) {
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
