<?php
/**
 * Event ID Generator
 *
 * Produces the two identifiers an outbox row carries:
 *
 * - `generateEventId()` - a globally unique id for one delivery. It is stable
 *   across retries because it is generated once at enqueue time and stored on
 *   the row, never recomputed per attempt.
 * - `generateDedupKey()` - a deterministic key over the event's subject, used to
 *   coalesce a burst of identical hook fires into one undelivered row.
 *
 * The event id used to embed a rounded time window so that a burst of hook
 * fires collapsed onto one id. That coupled coalescing to a clock instead of to
 * queue state: because the unique index covered rows that had already been
 * delivered, and nothing removed them, a second change to the same product
 * inside the window was silently dropped once the cron had already sent the
 * first one (#2603). Coalescing is now expressed on `dedup_key`, which the
 * repository clears the moment a row leaves the queue, so a change that happens
 * after a delivery always gets a row of its own whatever the cron cadence.
 *
 * @module prestashop-module/classes
 * @see {@link OutboxRepository} for event enqueueing
 */

class EventIdGenerator
{
    /**
     * Generate a globally unique event ID
     *
     * The value must be unique per outbox row: OpenLinker's webhook intake keys
     * its own durable replay protection on (provider, connectionId, eventId), so
     * reusing an id across rows would make the second delivery look like a
     * replay and be discarded.
     *
     * @param string $provider Provider name (e.g., 'prestashop')
     * @param string $connectionId Connection ID
     * @param string $eventType Event type (e.g., 'product.saved')
     * @param string $objectType Object type (e.g., 'product')
     * @param string $externalId External object ID
     * @param string $occurredAt ISO 8601 timestamp when event occurred
     * @return string Event ID (UUID-like format)
     */
    public static function generateEventId(
        $provider,
        $connectionId,
        $eventType,
        $objectType,
        $externalId,
        $occurredAt
    ) {
        $seed = sprintf(
            '%s|%s|%s|%s|%s|%s|%s|%s',
            $provider,
            $connectionId,
            $eventType,
            $objectType,
            $externalId,
            $occurredAt,
            microtime(true),
            self::entropy()
        );

        return self::formatAsUuid(hash('sha256', $seed));
    }

    /**
     * Generate the coalescing key for an event's subject
     *
     * Deterministic over the subject only, with no time component. Two hook
     * fires describing the same change therefore share a key and, while the
     * first row is still queued, the second insert is dropped by the unique
     * index. Once the row is delivered or has failed terminally the repository
     * nulls the column, which frees the key for the next real change.
     *
     * @param string $provider Provider name
     * @param string $connectionId Connection ID
     * @param string $eventType Event type
     * @param string $objectType Object type
     * @param string $externalId External object ID
     * @return string Deduplication key (UUID-like format)
     */
    public static function generateDedupKey(
        $provider,
        $connectionId,
        $eventType,
        $objectType,
        $externalId
    ) {
        $subject = sprintf(
            '%s|%s|%s|%s|%s',
            $provider,
            $connectionId,
            $eventType,
            $objectType,
            $externalId
        );

        return self::formatAsUuid(hash('sha256', $subject));
    }

    /**
     * Random material for the event id
     *
     * @return string
     */
    private static function entropy()
    {
        try {
            return bin2hex(random_bytes(16));
        } catch (Exception $e) {
            // random_bytes only fails if the platform has no usable CSPRNG. The
            // id still has to be unique, so fall back rather than break a hook.
            return uniqid('', true) . mt_rand();
        }
    }

    /**
     * Render a hex hash in the 8-4-4-4-12 shape the schema expects
     *
     * @param string $hash Hex hash, at least 32 characters
     * @return string
     */
    private static function formatAsUuid($hash)
    {
        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hash, 0, 8),
            substr($hash, 8, 4),
            substr($hash, 12, 4),
            substr($hash, 16, 4),
            substr($hash, 20, 12)
        );
    }
}
