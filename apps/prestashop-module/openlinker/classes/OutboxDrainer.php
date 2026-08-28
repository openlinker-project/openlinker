<?php
/**
 * Outbox Drainer
 *
 * The single deliver-one-event primitive shared by the cron controller
 * (`DeliveryRunner`) and the response-flush fast path (#2624), plus a
 * claim-and-drain-a-batch convenience built on top of it for callers (the
 * fast path) that have no per-run wall-clock budget of their own to enforce
 * between events. `DeliveryRunner::run` keeps its own claim/budget/retention
 * loop — its budget check has to run *between* events, before this class
 * ever sees the next one — but delegates the actual send-and-mark-outcome
 * step for a single event to `self::deliverOne()` here, so the retry/backoff
 * semantics (which exception types count, the attempts-vs-max comparison,
 * which repository method fires) exist in exactly one place and cannot drift
 * between the two delivery paths.
 *
 * @module prestashop-module/classes
 * @see {@link OutboxRepository} for event claiming and state management
 * @see {@link WebhookSender} for HTTP delivery
 * @see {@link DeliveryRunner} for the budget-aware caller
 */

class OutboxDrainer
{
    /**
     * Deliver a single already-claimed event, applying the retry ladder on
     * failure.
     *
     * `catch (Throwable ...)`, not `Exception`: a `TypeError` or other
     * `Error` raised inside `$sender->sendEvent()` must still resolve this
     * one event to `retried` or `failed` rather than escaping uncaught -
     * letting it escape would abort whichever caller's loop this runs
     * inside (a caller may be draining several events per call), stranding
     * every event after this one in `processing` until the next stale-row
     * sweep for no better reason than a single bad row.
     *
     * @param OutboxRepository $repository
     * @param WebhookSender $sender
     * @param OutboxEvent $event
     * @param int $maxAttempts Attempts after which a failing event is marked
     *        `failed` instead of retried. Taken as a plain parameter rather
     *        than read from `Configuration` here, so this method has no
     *        PrestaShop dependency beyond the two collaborators it is
     *        handed — callers resolve the operator's configured value.
     * @return bool true when delivered.
     */
    public static function deliverOne($repository, $sender, $event, $maxAttempts = 25)
    {
        try {
            $success = $sender->sendEvent($event);

            if ($success) {
                $repository->markDelivered($event->id);

                return true;
            }

            // Should not happen (sendEvent throws on failure), but handle
            // gracefully rather than leave the row stuck.
            $repository->scheduleRetry(
                $event->id,
                $event->attempts,
                'Webhook sender returned false'
            );

            return false;
        } catch (Throwable $e) {
            $errorMessage = WebhookSender::getErrorMessage($e);

            if ($event->attempts >= $maxAttempts) {
                $repository->markFailed($event->id, $errorMessage);
            } else {
                $repository->scheduleRetry($event->id, $event->attempts, $errorMessage);
            }

            return false;
        }
    }

    /**
     * Claims and delivers up to $batchSize outbox rows, optionally
     * restricted to a set of `object_type` values.
     *
     * Unlike `DeliveryRunner::run`, this has no per-run wall-clock budget:
     * every caller of this method (today, only the response-flush fast
     * path) bounds its own cost instead via a small, fixed `$batchSize`
     * and short per-request HTTP timeouts on `$sender`.
     *
     * @param OutboxRepository $repository
     * @param WebhookSender $sender
     * @param int $batchSize
     * @param string $runId Unique run identifier (used for the claim and,
     *        on an outer failure, to requeue exactly this run's rows)
     * @param string[]|null $objectTypes Restrict the claim to these object
     *        types. Null claims any type (the cron path's behaviour).
     * @param int $maxAttempts Attempts after which a failing event is marked
     *        `failed` instead of retried.
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
            if (self::deliverOne($repository, $sender, $event, $maxAttempts)) {
                $delivered++;
            } else {
                $failed++;
            }
        }

        return ['claimed' => count($events), 'delivered' => $delivered, 'failed' => $failed];
    }
}
