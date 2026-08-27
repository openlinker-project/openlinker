<?php

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for EventIdGenerator.
 *
 * No PS globals required.
 *
 * @see EventIdGenerator
 */
class EventIdGeneratorTest extends TestCase
{
    private const PROVIDER      = 'prestashop';
    private const CONNECTION_ID = 'conn-abc-123';
    private const EVENT_TYPE    = 'product.saved';
    private const OBJECT_TYPE   = 'product';
    private const EXTERNAL_ID   = '42';

    private const UUID_LIKE = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    private function generateEventId(
        string $occurredAt = '2024-01-15 10:00:30',
        string $externalId = self::EXTERNAL_ID
    ): string {
        return EventIdGenerator::generateEventId(
            self::PROVIDER,
            self::CONNECTION_ID,
            self::EVENT_TYPE,
            self::OBJECT_TYPE,
            $externalId,
            $occurredAt
        );
    }

    private function generateDedupKey(
        string $externalId = self::EXTERNAL_ID,
        string $eventType = self::EVENT_TYPE
    ): string {
        return EventIdGenerator::generateDedupKey(
            self::PROVIDER,
            self::CONNECTION_ID,
            $eventType,
            self::OBJECT_TYPE,
            $externalId
        );
    }

    // Event id: unique per call

    public function testEventIdIsUniquePerCallEvenForIdenticalInputs(): void
    {
        // OL's intake keys replay protection on the event id, so two outbox rows
        // must never share one (#2603).
        $ids = [];
        for ($i = 0; $i < 100; $i++) {
            $ids[] = $this->generateEventId();
        }

        $this->assertCount(100, array_unique($ids));
    }

    public function testEventIdMatchesUuidLikeFormat(): void
    {
        $this->assertMatchesRegularExpression(self::UUID_LIKE, $this->generateEventId());
    }

    // Dedup key: deterministic over the subject, with no time component

    public function testDedupKeyIsStableForTheSameSubject(): void
    {
        // The key carries no timestamp, so it stays the same across windows and
        // coalesces only while a row is still queued.
        $this->assertSame($this->generateDedupKey(), $this->generateDedupKey());
    }

    public function testDistinctExternalIdsProduceDistinctDedupKeys(): void
    {
        $this->assertNotSame($this->generateDedupKey('42'), $this->generateDedupKey('99'));
    }

    public function testDistinctEventTypesProduceDistinctDedupKeys(): void
    {
        $this->assertNotSame(
            $this->generateDedupKey(self::EXTERNAL_ID, 'product.saved'),
            $this->generateDedupKey(self::EXTERNAL_ID, 'stock.updated')
        );
    }

    public function testDedupKeyMatchesUuidLikeFormat(): void
    {
        $this->assertMatchesRegularExpression(self::UUID_LIKE, $this->generateDedupKey());
    }
}
