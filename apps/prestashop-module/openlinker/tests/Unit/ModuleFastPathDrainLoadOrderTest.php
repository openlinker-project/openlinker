<?php

use PHPUnit\Framework\TestCase;

/**
 * Class-load-order invariants for OpenLinker::scheduleFastPathDrain() (#2962).
 *
 * The module file cannot be loaded here - it extends PrestaShop's Module and
 * pulls half the framework with it - so these read the source, exactly as
 * ModuleHookRegistrationTest does for the hook table.
 *
 * The defect these exist to prevent: `WebhookSender::fastPathAvailable()` was
 * called ~20 lines above the `require_once` that loads that class, which sat
 * inside the register_shutdown_function closure. On any request where nothing
 * else had already pulled WebhookSender in, PHP raised a fatal
 * `Class "WebhookSender" not found` - inside hookActionValidateOrderAfter,
 * hookActionOrderHistoryAddAfter and hookActionUpdateQuantity, i.e. the shop's
 * own checkout and stock paths. It was load- and route-dependent rather than
 * deterministic, which is why it survived review and why the guard is a test
 * rather than a comment.
 */
class ModuleFastPathDrainLoadOrderTest extends TestCase
{
    /** @var string */
    private static $source;

    /** @var string */
    private static $method;

    public static function setUpBeforeClass(): void
    {
        self::$source = file_get_contents(dirname(__DIR__, 2) . '/openlinker.php');
        self::$method = self::extractScheduleFastPathDrain(self::$source);
    }

    /**
     * The body of scheduleFastPathDrain(), from its signature to the end of the
     * file (the method is last in the class, and every assertion below is an
     * ordering one, so trailing braces are harmless).
     *
     * Full-line `//` comments are stripped, because the assertions below are
     * positional and the guard they protect is deliberately broad - it looks
     * for ANY `WebhookSender::` reference rather than one method name, so a
     * comment merely mentioning one would otherwise register as a use site and
     * fail the test against correct code. Only whole comment lines are removed,
     * so a `//` inside a string literal is never touched.
     */
    private static function extractScheduleFastPathDrain(string $source): string
    {
        $start = strpos($source, 'public static function scheduleFastPathDrain()');
        self::assertNotFalse($start, 'scheduleFastPathDrain() not found in openlinker.php');

        $lines = explode("\n", substr($source, $start));
        $code = array_filter($lines, static function ($line) {
            return strpos(ltrim($line), '//') !== 0;
        });

        return implode("\n", $code);
    }

    public function testWebhookSenderIsLoadedBeforeItsFirstStaticReference(): void
    {
        $require = strpos(self::$method, 'require_once($senderPath)');
        $firstUse = strpos(self::$method, 'WebhookSender::');

        self::assertNotFalse($require, 'no require_once for WebhookSender.php in scheduleFastPathDrain()');
        self::assertNotFalse($firstUse, 'no WebhookSender:: reference in scheduleFastPathDrain()');
        self::assertLessThan(
            $firstUse,
            $require,
            'WebhookSender.php must be required before the first WebhookSender:: static call - '
                . 'otherwise PHP fatals with Class "WebhookSender" not found'
        );
    }

    public function testClassesDirIsAssignedBeforeTheRequire(): void
    {
        $assign = strpos(self::$method, '$classesDir = dirname(__FILE__)');
        $senderPath = strpos(self::$method, "\$senderPath = \$classesDir . 'WebhookSender.php'");
        $require = strpos(self::$method, 'require_once($senderPath)');

        self::assertNotFalse($assign, '$classesDir is not assigned in scheduleFastPathDrain()');
        self::assertNotFalse($senderPath, '$senderPath is not built from $classesDir');
        self::assertNotFalse($require, 'no require_once for WebhookSender.php in scheduleFastPathDrain()');
        self::assertLessThan($senderPath, $assign, '$classesDir must be assigned before $senderPath is built');
        self::assertLessThan($require, $senderPath, '$senderPath must be built before it is required');
    }

    public function testTheLoadIsGuardedByClassExists(): void
    {
        self::assertStringContainsString(
            "if (!class_exists('WebhookSender')) {",
            self::$method,
            'the WebhookSender load must reuse the module-wide class_exists guard'
        );
    }

    public function testTheReentrancyLatchStillRunsFirst(): void
    {
        $latchRead = strpos(self::$method, 'if (self::$fastPathDrainScheduled) {');
        $latchSet = strpos(self::$method, 'self::$fastPathDrainScheduled = true;');
        $require = strpos(self::$method, 'require_once($senderPath)');

        self::assertNotFalse($latchRead, 'the re-entrancy latch read is missing');
        self::assertNotFalse($latchSet, 'the re-entrancy latch write is missing');
        self::assertNotFalse($require, 'no require_once for WebhookSender.php in scheduleFastPathDrain()');
        self::assertLessThan($latchSet, $latchRead, 'the latch must be read before it is set');
        self::assertLessThan($require, $latchSet, 'the latch must be set before any class loading work');
    }

    public function testTheResponseFlushOrderingIsIntact(): void
    {
        $schedule = strpos(self::$method, 'register_shutdown_function(function () use ($classesDir) {');
        $ignoreAbort = strpos(self::$method, 'ignore_user_abort(true);');
        $flush = strpos(self::$method, 'fastcgi_finish_request();');
        $drain = strpos(self::$method, 'OutboxDrainer::drainBatch(');

        self::assertNotFalse($schedule, 'register_shutdown_function call is missing');
        self::assertNotFalse($ignoreAbort, 'ignore_user_abort(true) is missing');
        self::assertNotFalse($flush, 'fastcgi_finish_request() is missing');
        self::assertNotFalse($drain, 'OutboxDrainer::drainBatch call is missing');

        self::assertLessThan($ignoreAbort, $schedule, 'the flush must happen inside the shutdown callback');
        self::assertLessThan($flush, $ignoreAbort, 'ignore_user_abort must precede fastcgi_finish_request');
        self::assertLessThan($drain, $flush, 'the buyer response must be flushed before the drain runs');
    }

    /**
     * A failed require_once is E_COMPILE_ERROR - no catch block in the module
     * can intercept it - and this method runs on the order-validation and
     * stock hooks. So an incomplete module upload must disable the fast path,
     * never abort the shop's checkout.
     */
    public function testTheLoadCannotFatalTheHook(): void
    {
        $fileExists = strpos(self::$method, "file_exists(\$senderPath)");
        $require = strpos(self::$method, 'require_once($senderPath)');

        self::assertNotFalse($fileExists, 'the WebhookSender require must be file_exists-guarded');
        self::assertNotFalse($require, 'the WebhookSender require must use the probed $senderPath');
        self::assertLessThan($require, $fileExists, 'file_exists must be checked before require_once');
    }

    public function testAnUnloadableSenderDegradesInsteadOfScheduling(): void
    {
        $guards = substr_count(self::$method, "if (!class_exists('WebhookSender')) {");
        self::assertSame(
            2,
            $guards,
            'expected the load attempt and a post-load re-check - without the re-check the closure '
                . 'would be scheduled with the class absent, and its own catch handler would fatal'
        );

        $recheck = strrpos(self::$method, "if (!class_exists('WebhookSender')) {");
        $firstUse = strpos(self::$method, 'WebhookSender::');
        $schedule = strpos(self::$method, 'register_shutdown_function(');

        self::assertLessThan($firstUse, $recheck, 'the re-check must precede any static call');
        self::assertLessThan($schedule, $recheck, 'the re-check must precede scheduling');
    }

    public function testTheDegradedPathIsNotSilent(): void
    {
        self::assertStringContainsString(
            'PrestaShopLogger::addLog(',
            self::$method,
            'an unloadable sender must be logged - otherwise the fast path stays off with nothing to find'
        );
        self::assertStringContainsString(
            'response-flush fast path disabled',
            self::$method,
            'the degraded-path log must say the fast path was disabled'
        );
    }

    public function testTheClosureDoesNotReloadWebhookSender(): void
    {
        $schedule = strpos(self::$method, 'register_shutdown_function(');
        $closure = substr(self::$method, $schedule);

        // Deliberately matches the FILENAME rather than one require_once
        // spelling: an assertion pinned to a specific call shape goes
        // vacuously true the moment that shape changes, which is exactly what
        // happened to an earlier revision of this test.
        self::assertStringNotContainsString(
            'WebhookSender.php',
            $closure,
            'the closure must not load WebhookSender in any form - the guard above already guarantees it'
        );
    }

    public function testTheAvailabilityGuardStillShortCircuits(): void
    {
        self::assertStringContainsString(
            "if (!WebhookSender::fastPathAvailable()) {",
            self::$method,
            'the fast path must still be skipped on a host without fastcgi_finish_request/ignore_user_abort'
        );

        $guard = strpos(self::$method, 'if (!WebhookSender::fastPathAvailable()) {');
        $schedule = strpos(self::$method, 'register_shutdown_function(');

        self::assertLessThan($schedule, $guard, 'the availability guard must run before anything is scheduled');
    }

    public function testTheFastPathDrainFailureStaysLogOnly(): void
    {
        self::assertStringContainsString(
            'catch (Throwable $e) {',
            self::$method,
            'the shutdown drain must keep its catch-all - the cron path still owns these outbox rows'
        );
        self::assertStringContainsString(
            'OpenLinker: response-flush fast-path drain failed: ',
            self::$method,
            'a fast-path failure must surface in the log and nowhere else'
        );
    }

    /**
     * @return string[]
     */
    private function fastPathDrainCallSites(): array
    {
        preg_match_all(
            '/public function (hook[A-Za-z]+)\(array \$params\)/',
            self::$source,
            $handlers,
            PREG_OFFSET_CAPTURE
        );

        $callers = [];
        foreach ($handlers[1] as $index => $handler) {
            $start = $handlers[0][$index][1];
            $end = $index + 1 < count($handlers[0])
                ? $handlers[0][$index + 1][1]
                : strlen(self::$source);

            $body = substr(self::$source, $start, $end - $start);
            if (strpos($body, 'self::scheduleFastPathDrain();') !== false) {
                $callers[] = $handler[0];
            }
        }

        return $callers;
    }

    public function testEveryKnownCallSiteIsStillWired(): void
    {
        $callers = $this->fastPathDrainCallSites();

        self::assertContains('hookActionValidateOrderAfter', $callers);
        self::assertContains('hookActionOrderHistoryAddAfter', $callers);
        self::assertContains('hookActionUpdateQuantity', $callers);
        self::assertCount(
            3,
            $callers,
            'a new scheduleFastPathDrain() call site was added - confirm the load-order guard covers it'
        );
    }
}
