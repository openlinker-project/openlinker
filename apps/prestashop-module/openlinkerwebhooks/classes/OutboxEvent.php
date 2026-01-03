<?php
/**
 * Outbox Event Model
 *
 * Represents a webhook event in the outbox table. Used for reading/writing
 * outbox records. This is a simple data transfer object (DTO) that maps
 * database rows to PHP objects.
 *
 * @module prestashop-module/classes
 * @see {@link OutboxRepository} for persistence operations
 */

class OutboxEvent
{
    public $id;
    public $event_id;
    public $schema_version;
    public $provider;
    public $connection_id;
    public $event_type;
    public $object_type;
    public $external_id;
    public $occurred_at;
    public $payload_json;
    public $status;
    public $attempts;
    public $next_attempt_at;
    public $last_error;
    public $processing_owner;
    public $processing_started_at;
    public $created_at;
    public $updated_at;
    public $delivered_at;

    /**
     * Create OutboxEvent from database row array
     *
     * @param array $row Database row
     * @return OutboxEvent
     */
    public static function fromArray(array $row)
    {
        $event = new self();
        $event->id = isset($row['id']) ? (int)$row['id'] : null;
        $event->event_id = isset($row['event_id']) ? $row['event_id'] : null;
        $event->schema_version = isset($row['schema_version']) ? (int)$row['schema_version'] : 1;
        $event->provider = isset($row['provider']) ? $row['provider'] : 'prestashop';
        $event->connection_id = isset($row['connection_id']) ? $row['connection_id'] : null;
        $event->event_type = isset($row['event_type']) ? $row['event_type'] : null;
        $event->object_type = isset($row['object_type']) ? $row['object_type'] : null;
        $event->external_id = isset($row['external_id']) ? $row['external_id'] : null;
        $event->occurred_at = isset($row['occurred_at']) ? $row['occurred_at'] : null;
        $event->payload_json = isset($row['payload_json']) ? $row['payload_json'] : null;
        $event->status = isset($row['status']) ? $row['status'] : 'pending';
        $event->attempts = isset($row['attempts']) ? (int)$row['attempts'] : 0;
        $event->next_attempt_at = isset($row['next_attempt_at']) ? $row['next_attempt_at'] : null;
        $event->last_error = isset($row['last_error']) ? $row['last_error'] : null;
        $event->processing_owner = isset($row['processing_owner']) ? $row['processing_owner'] : null;
        $event->processing_started_at = isset($row['processing_started_at']) ? $row['processing_started_at'] : null;
        $event->created_at = isset($row['created_at']) ? $row['created_at'] : null;
        $event->updated_at = isset($row['updated_at']) ? $row['updated_at'] : null;
        $event->delivered_at = isset($row['delivered_at']) ? $row['delivered_at'] : null;

        return $event;
    }
}
