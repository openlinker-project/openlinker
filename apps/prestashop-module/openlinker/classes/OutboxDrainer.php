<?php
/**
 * Outbox Drainer
 *
 * The claim-send-mark loop shared by the cron controller and the
 * response-flush fast path (#2624). Extracted so the retry/backoff/error
 * handling in that loop cannot drift between the two delivery paths - the
 * fast path is a second caller of the exact same delivery semantics, not a
 * parallel implementation of them.
 *
 * @module prestashop-module/classes
 * @see {@link OutboxRepository} for event claiming and state management
 * @see {@link WebhookSender} for HTTP delivery
 */

class OutboxDrainer
{
    /**
     * Claims and delivers up to $batchSize outbox rows, optionally
     * restricted to a set of `object_type` values.
     *
     * @param OutboxRepository $repository
     * @param WebhookSender $sender
     * @param int $batchSize
     * @param string $runId Unique run identifier (used for the claim and,
     *        on an outer failure, to requeue exactly this run's rows)
     * @param string[]|null $objectTypes Restrict the claim to these object
     *        types. Null claims any type (the cron path's behaviour).
     * @param int $maxAttempts Attempts after which a failing event is marked
     *        `failed` instead of retried. Taken as a plain parameter rather
     *        than read from `Configuration` here, so this method has no
     *        PrestaShop dependency beyond the two collaborators it is
     *        handed — callers resolve the operator's configured value.
     * @return array{claimed:int, delivered:int, failed:int}
     */
    public static function drainBatch($repository, $sender, $batchSize, $runId, $objectTypes = null, $maxAttempts = 25)
    {
        $events = $repository->claimBatchDueForDelivery($batchSize, $runId, $objectTypes);

        if (empty($events)) {
            return ['claimed' => 0, 'delivered' => 0, 'failed' => 0];
        }

        $delivered = 0;
        $failed = 0;

        foreach ($events as $event) {
            try {
                $success = $sender->sendEvent($event);

                if ($success) {
                    $repository->markDelivered($event->id);
                    $delivered++;
                } else {
                    // Should not happen (sendEvent throws on failure), but
                    // handle gracefully rather than leave the row stuck.
                    $repository->scheduleRetry(
                        $event->id,
                        $event->attempts,
                        'Webhook sender returned false'
                    );
                    $failed++;
                }
            } catch (Exception $e) {
                $errorMessage = WebhookSender::getErrorMessage($e);

                if ($event->attempts >= $maxAttempts) {
                    $repository->markFailed($event->id, $errorMessage);
                } else {
                    $repository->scheduleRetry($event->id, $event->attempts, $errorMessage);
                }
                $failed++;
            }
        }

        return ['claimed' => count($events), 'delivered' => $delivered, 'failed' => $failed];
    }
}
