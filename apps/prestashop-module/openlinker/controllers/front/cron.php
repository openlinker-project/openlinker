<?php
/**
 * Cron Front Controller
 *
 * Handles cron-triggered webhook delivery. Secured with token parameter.
 * URL: .../index.php?fc=module&module=openlinker&controller=cron&token=...
 *
 * This controller processes webhook events from the outbox table:
 * 1. Requeues stale processing rows (recovery from crashes)
 * 2. Claims a batch of pending events (atomic locking)
 * 3. Sends events via HTTP POST with retry/backoff
 * 4. Updates event status (delivered/failed)
 * 5. Runs outbox retention (deletes terminal rows past their horizon)
 *
 * Designed to be called by external cron (e.g., every minute) or PrestaShop's
 * internal cron system.
 *
 * @module prestashop-module/controllers
 * @see {@link OutboxRepository} for event claiming and state management
 * @see {@link WebhookSender} for HTTP delivery
 *
 * @author OpenLinker Team
 * @version 1.0.0
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

class OpenLinkerCronModuleFrontController extends ModuleFrontController
{
    public function initContent()
    {
        parent::initContent();

        // Security: Validate token
        $token = Tools::getValue('token');
        $expectedToken = Configuration::get('OPENLINKER_CRON_TOKEN');

        if (empty($token) || $token !== $expectedToken) {
            http_response_code(403);
            header('Content-Type: application/json');
            echo json_encode([
                'error' => 'Forbidden',
                'message' => 'Invalid or missing token'
            ]);
            exit;
        }

        // Ensure classes are loaded
        $classesDir = dirname(__FILE__) . '/../../classes/';
        
        if (!class_exists('EventIdGenerator')) {
            require_once($classesDir . 'EventIdGenerator.php');
        }
        if (!class_exists('OutboxEvent')) {
            require_once($classesDir . 'OutboxEvent.php');
        }
        if (!class_exists('OutboxRepository')) {
            require_once($classesDir . 'OutboxRepository.php');
        }
        if (!class_exists('WebhookSender')) {
            require_once($classesDir . 'WebhookSender.php');
        }

        try {
            $repository = new OutboxRepository();
            $sender = new WebhookSender();

            // Step 1: Requeue stale processing rows (older than threshold)
            $requeued = $repository->requeueStaleProcessingRows();

            // Step 2: Get batch size from configuration
            $batchSize = (int)Configuration::get('BATCH_SIZE') ?: 50; // Default defined in module class

            // Step 3: Generate unique runId for this cron execution
            $runId = uniqid('cron_', true);

            // Step 4: Claim batch (atomically marks rows as processing)
            $events = $repository->claimBatchDueForDelivery($batchSize, $runId);

            if (empty($events)) {
                // An idle queue is exactly when retention should run, so it
                // happens before the early return, not after the loop only.
                $retention = self::runRetention($repository);

                header('Content-Type: application/json');
                echo json_encode([
                    'processed' => 0,
                    'delivered' => 0,
                    'failed' => 0,
                    'requeued' => $requeued,
                    'retention' => $retention,
                ]);
                exit;
            }

            // Step 5: Process events
            $delivered = 0;
            $failed = 0;

            foreach ($events as $event) {
                try {
                    // Send webhook
                    $success = $sender->sendEvent($event);

                    if ($success) {
                        // Mark as delivered
                        $repository->markDelivered($event->id);
                        $delivered++;
                    } else {
                        // Should not happen (sendEvent throws on failure)
                        // But handle gracefully
                        $repository->scheduleRetry(
                            $event->id,
                            $event->attempts,
                            'Webhook sender returned false'
                        );
                        $failed++;
                    }
                } catch (Exception $e) {
                    // Extract error message (sanitized, no secrets)
                    $errorMessage = WebhookSender::getErrorMessage($e);

                    // Get max attempts from configuration
                    $maxAttempts = (int)Configuration::get('MAX_RETRY_ATTEMPTS') ?: 25;

                    // Check if max attempts reached
                    if ($event->attempts >= $maxAttempts) {
                        // Mark as failed
                        $repository->markFailed($event->id, $errorMessage);
                        $failed++;
                    } else {
                        // Schedule retry with exponential backoff
                        $repository->scheduleRetry(
                            $event->id,
                            $event->attempts,
                            $errorMessage
                        );
                        $failed++;
                    }
                }
            }

            // Step 6: Retention. Runs after delivery so a pass can never
            // delay an event, and self-rate-limits internally.
            $retention = self::runRetention($repository);

            // Step 7: Return statistics
            header('Content-Type: application/json');
            echo json_encode([
                'processed' => count($events),
                'delivered' => $delivered,
                'failed' => $failed,
                'requeued' => $requeued,
                'retention' => $retention,
            ]);
        } catch (Exception $e) {
            // If outer exception, requeue any events that were claimed but not processed
            try {
                if (isset($repository) && isset($runId)) {
                    $repository->requeueEventsByRunId($runId, 'Cron delivery failed: ' . $e->getMessage());
                }
            } catch (Exception $cleanupError) {
                // Log cleanup error but don't fail the main error
                PrestaShopLogger::addLog(
                    'OpenLinker: Failed to cleanup events after cron error: ' . $cleanupError->getMessage(),
                    3,
                    null,
                    'Module',
                    null
                );
            }

            http_response_code(500);
            header('Content-Type: application/json');
            echo json_encode([
                'error' => 'Internal Server Error',
                'message' => 'Cron delivery failed: ' . WebhookSender::getErrorMessage($e)
            ]);
        }
    }

    /**
     * Run one outbox retention pass (#2604)
     *
     * Never fatal: retention is housekeeping, and a shop whose outbox cannot
     * be pruned must still deliver its events.
     *
     * @param OutboxRepository $repository
     * @return array Retention report for the cron response
     */
    private static function runRetention($repository)
    {
        try {
            $report = $repository->runRetention();

            if (!empty($report['backlog_over_cap'])) {
                // Every terminal row is gone and the table is still over the
                // cap, so the excess is undelivered work. Retention will not
                // touch it - an operator has to.
                $rows = (int)$report['rows'];
                PrestaShopLogger::addLog(
                    'OpenLinker: outbox is over its row cap ('
                    . (empty($report['rows_capped']) ? (string)$rows : $rows . '+')
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
