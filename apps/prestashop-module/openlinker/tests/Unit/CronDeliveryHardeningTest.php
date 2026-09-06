<?php

use PHPUnit\Framework\TestCase;

/**
 * Source-level guards for the cron delivery path (#2618).
 *
 * DeliveryRunner and the shipped cron file both need a PrestaShop runtime to
 * execute, so these two properties are asserted against the source. Both are
 * one-token mistakes that are silent in production: an Error skipping a
 * requeue leaves claimed rows stuck in `processing`, and a CLI check that trusts
 * PHP_SAPI alone serves an unauthenticated delivery pass on a host that runs
 * .php through a CLI wrapper.
 */
class CronDeliveryHardeningTest extends TestCase
{
    public function testTheDeliveryPassCatchesErrorsAsWellAsExceptions(): void
    {
        $source = self::sourceOf('classes/DeliveryRunner.php');

        self::assertStringNotContainsString('catch (Exception', $source);
        self::assertStringContainsString('catch (Throwable', $source);
    }

    /**
     * OutboxDrainer::deliverOne (#2635 review) is the single per-event
     * delivery primitive both DeliveryRunner and the response-flush fast
     * path now share. A regression back to `catch (Exception ...)` here
     * would let a TypeError/Error from `sendEvent()` escape uncaught,
     * aborting whichever caller's batch loop is in progress instead of
     * resolving just that one event to retried/failed.
     */
    public function testTheOutboxDrainerCatchesErrorsAsWellAsExceptions(): void
    {
        $source = self::sourceOf('classes/OutboxDrainer.php');

        self::assertStringNotContainsString('catch (Exception', $source);
        self::assertStringContainsString('catch (Throwable', $source);
    }

    /**
     * DeliveryRunner must delegate its per-event delivery to
     * OutboxDrainer::deliverOne rather than re-implementing the claim-send-
     * mark loop itself (#2635 review) - a second implementation is exactly
     * how the two delivery paths' retry semantics drift apart.
     */
    public function testTheDeliveryPassDelegatesPerEventDeliveryToOutboxDrainer(): void
    {
        $source = self::sourceOf('classes/DeliveryRunner.php');

        self::assertStringContainsString('OutboxDrainer::deliverOne', $source);
        self::assertStringNotContainsString('private static function deliverOne', $source);
    }

    public function testTheCronFileCatchesErrorsAsWellAsExceptions(): void
    {
        $source = self::sourceOf('cron/openlinker-cron.php');

        self::assertStringNotContainsString('catch (Exception', $source);
        self::assertStringContainsString('catch (Throwable', $source);
    }

    public function testTheCliCheckAlsoRequiresTheAbsenceOfARequest(): void
    {
        $source = self::sourceOf('cron/openlinker-cron.php');

        self::assertStringContainsString("!isset(\$_SERVER['REQUEST_METHOD'])", $source);
    }

    public function testTheCronDirectoryDeniesWebAccess(): void
    {
        $htaccess = self::sourceOf('cron/.htaccess');

        self::assertStringContainsString('Require all denied', $htaccess);
        self::assertStringContainsString('Deny from all', $htaccess);
    }

    /**
     * #2923: the HTTP cron front controller's success branch had no `exit;`,
     * unlike its four early-return branches - so a successful delivery fell
     * through into PrestaShop's ordinary page render, which either fatals
     * (an unwritable theme cache) or appends a whole HTML document after the
     * JSON (a writable one). Both the success and catch branches must
     * terminate the request immediately after their envelope.
     */
    public function testTheSuccessBranchExitsAfterItsJsonEnvelope(): void
    {
        $source = self::sourceOf('controllers/front/cron.php');

        $runAt = strpos($source, 'DeliveryRunner::run');
        $echoAt = strpos($source, 'echo json_encode($stats);');
        $catchAt = strpos($source, 'catch (Exception $e)');

        self::assertIsInt($runAt);
        self::assertIsInt($echoAt);
        self::assertIsInt($catchAt);
        self::assertGreaterThan($runAt, $echoAt);
        self::assertLessThan($catchAt, $echoAt);

        $betweenEchoAndCatch = substr($source, $echoAt, $catchAt - $echoAt);
        self::assertStringContainsString('exit;', $betweenEchoAndCatch);
    }

    public function testTheCatchBranchAlsoExitsAfterItsJsonEnvelope(): void
    {
        $source = self::sourceOf('controllers/front/cron.php');

        $catchAt = strpos($source, 'catch (Exception $e)');
        self::assertIsInt($catchAt);

        $afterCatch = substr($source, $catchAt);
        $echoAt = strpos($afterCatch, 'echo json_encode([');
        self::assertIsInt($echoAt);

        $afterEcho = substr($afterCatch, $echoAt);
        self::assertStringContainsString('exit;', $afterEcho);
    }

    private static function sourceOf(string $relativePath): string
    {
        $path = __DIR__ . '/../../' . $relativePath;
        self::assertFileExists($path);

        return (string) file_get_contents($path);
    }
}
