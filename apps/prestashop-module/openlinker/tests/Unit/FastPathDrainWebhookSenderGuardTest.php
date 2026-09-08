<?php

use PHPUnit\Framework\TestCase;

/**
 * Regression test for #2962: scheduleFastPathDrain() referenced
 * WebhookSender::fastPathAvailable() without the class_exists/require_once
 * guard every other WebhookSender call site in openlinker.php uses. On a
 * request where nothing had already autoloaded the class, that fataled
 * straight out of hookActionValidateOrderAfter / hookActionUpdateQuantity -
 * silent at runtime, so (like ModuleHookRegistrationTest) this reads the
 * source rather than executing the module.
 */
class FastPathDrainWebhookSenderGuardTest extends TestCase
{
    /** @var string */
    private static $source;

    public static function setUpBeforeClass(): void
    {
        self::$source = file_get_contents(dirname(__DIR__, 2) . '/openlinker.php');
    }

    private function methodBody(string $signature): string
    {
        $start = strpos(self::$source, $signature);
        self::assertNotFalse($start, $signature . ' not found');

        return substr(self::$source, $start, 2000);
    }

    public function testScheduleFastPathDrainLoadsWebhookSenderBeforeFirstStaticReference(): void
    {
        $body = $this->methodBody('public static function scheduleFastPathDrain()');

        $guardPos = strpos($body, "class_exists('WebhookSender')");
        $callPos = strpos($body, 'WebhookSender::');

        self::assertNotFalse($guardPos, 'scheduleFastPathDrain() no longer guards WebhookSender with class_exists');
        self::assertNotFalse($callPos, 'scheduleFastPathDrain() no longer references WebhookSender::');
        self::assertLessThan(
            $callPos,
            $guardPos,
            'WebhookSender is referenced before the class_exists guard in scheduleFastPathDrain() - this fatals on any request where nothing has autoloaded it yet (#2962)'
        );
    }

    public function testScheduleFastPathDrainComputesClassesDirBeforeUsingIt(): void
    {
        $body = $this->methodBody('public static function scheduleFastPathDrain()');

        $classesDirPos = strpos($body, '$classesDir = dirname(__FILE__)');
        $usePos = strpos($body, '$classesDir . ');

        self::assertNotFalse($classesDirPos, '$classesDir assignment not found in scheduleFastPathDrain()');
        self::assertNotFalse($usePos, '$classesDir is never used in scheduleFastPathDrain()');
        self::assertLessThan(
            $usePos,
            $classesDirPos,
            '$classesDir is used before it is assigned in scheduleFastPathDrain() (#2962)'
        );
    }
}
