<?php
/**
 * Event ID Generator
 *
 * Generates stable, unique event IDs for webhook events. Event IDs must be
 * stable across retries (generate once when enqueueing, reuse for all attempts).
 *
 * Uses a configurable time window (deduplication window) to prevent duplicate
 * events when the same hook fires multiple times rapidly. The time window is
 * rounded to the nearest window boundary (e.g., if window is 1 minute, events
 * within the same minute generate the same event ID).
 *
 * @module prestashop-module/classes
 * @see {@link OutboxRepository} for event enqueueing
 */

class EventIdGenerator
{
    /**
     * Generate a unique event ID
     *
     * Generates a deterministic event ID based on the event properties and a configurable
     * time window (deduplication window). This ensures that if the same hook fires multiple
     * times within the same time window for the same object (common in PrestaShop), it will
     * generate the same event ID, preventing duplicate events via the unique constraint on event_id.
     *
     * Event ID format: Deterministic hash based on:
     *   - provider + connectionId + eventType + objectType + externalId + timeWindow
     *   where timeWindow is the timestamp rounded to the nearest deduplication window boundary
     *
     * This approach:
     * - Prevents duplicate events when hooks fire multiple times rapidly (PrestaShop behavior)
     * - Still allows separate events for different time windows (correct behavior)
     * - Works across multiple PHP processes (no shared state needed)
     * - No performance overhead (INSERT IGNORE handles duplicates efficiently)
     * - Configurable deduplication window (default: 1 minute)
     *
     * @param string $provider Provider name (e.g., 'prestashop')
     * @param string $connectionId Connection ID
     * @param string $eventType Event type (e.g., 'product.saved')
     * @param string $objectType Object type (e.g., 'product')
     * @param string $externalId External object ID
     * @param string $occurredAt ISO 8601 timestamp when event occurred
     * @param int    $windowMinutes Deduplication window in minutes (default: 1). The production
     *                             caller resolves this from Configuration::get('DEDUPLICATION_WINDOW_MINUTES').
     * @return string Event ID (deterministic hash-based, UUID-like format)
     */
    public static function generateEventId(
        $provider,
        $connectionId,
        $eventType,
        $objectType,
        $externalId,
        $occurredAt,
        $windowMinutes = 1
    ) {
        $windowMinutes = max(1, (int) $windowMinutes);
        $windowSeconds = $windowMinutes * 60;

        // Round timestamp to the nearest window boundary to create a time window
        // This prevents duplicate events when the same hook fires multiple times
        // within the same window (common in PrestaShop - can fire 6+ times per save)
        $timestamp = strtotime($occurredAt);
        $roundedTimestamp = floor($timestamp / $windowSeconds) * $windowSeconds;
        $timeWindow = date('Y-m-d H:i:s', $roundedTimestamp);
        
        // Create a deterministic string from all event properties
        $eventKey = sprintf(
            '%s|%s|%s|%s|%s|%s',
            $provider,
            $connectionId,
            $eventType,
            $objectType,
            $externalId,
            $timeWindow
        );
        
        // Generate a deterministic hash (SHA-256)
        // This ensures same inputs = same event ID
        $hash = hash('sha256', $eventKey);
        
        // Format as UUID-like string for consistency with existing schema
        // Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
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
