<?php

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for EventIdGenerator.
 *
 * No PS globals required — window is injected as a parameter.
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

    private function generate(
        string $occurredAt,
        int $windowMinutes = 1,
        string $externalId = self::EXTERNAL_ID
    ): string {
        return EventIdGenerator::generateEventId(
            self::PROVIDER,
            self::CONNECTION_ID,
            self::EVENT_TYPE,
            self::OBJECT_TYPE,
            $externalId,
            $occurredAt,
            $windowMinutes
        );
    }

    // ── Determinism ───────────────────────────────────────────────────────────

    public function testSameInputsProduceSameOutput(): void
    {
        $id1 = $this->generate('2024-01-15 10:00:30');
        $id2 = $this->generate('2024-01-15 10:00:30');

        $this->assertSame($id1, $id2);
    }

    public function testTimestampsWithinSameWindowProduceSameOutput(): void
    {
        // Both within the same 1-minute window (10:00:00–10:00:59)
        $id1 = $this->generate('2024-01-15 10:00:05');
        $id2 = $this->generate('2024-01-15 10:00:55');

        $this->assertSame($id1, $id2);
    }

    // ── Window boundary ───────────────────────────────────────────────────────

    public function testTimestampsInDifferentWindowsProduceDifferentOutputs(): void
    {
        // 10:00:30 is in window 10:00; 10:01:05 is in window 10:01
        $id1 = $this->generate('2024-01-15 10:00:30');
        $id2 = $this->generate('2024-01-15 10:01:05');

        $this->assertNotSame($id1, $id2);
    }

    public function testCustomWindowGroupsTimestampsCorrectly(): void
    {
        // 5-minute window: 10:00–10:04 should all be the same window
        $id1 = $this->generate('2024-01-15 10:00:00', 5);
        $id2 = $this->generate('2024-01-15 10:04:59', 5);
        $id3 = $this->generate('2024-01-15 10:05:00', 5); // next window

        $this->assertSame($id1, $id2, 'Timestamps within 5-min window should match');
        $this->assertNotSame($id1, $id3, 'Timestamps in different 5-min windows should differ');
    }

    // ── Output format ─────────────────────────────────────────────────────────

    public function testOutputMatchesUuidLikeFormat(): void
    {
        $id = $this->generate('2024-01-15 10:00:00');

        // xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (8-4-4-4-12 hex chars)
        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/',
            $id
        );
    }

    // ── Uniqueness ────────────────────────────────────────────────────────────

    public function testDistinctExternalIdsInSameWindowProduceDistinctOutputs(): void
    {
        $id1 = $this->generate('2024-01-15 10:00:00', 1, '42');
        $id2 = $this->generate('2024-01-15 10:00:00', 1, '99');

        $this->assertNotSame($id1, $id2);
    }
}
