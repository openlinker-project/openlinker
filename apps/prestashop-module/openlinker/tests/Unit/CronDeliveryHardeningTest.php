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

    private static function sourceOf(string $relativePath): string
    {
        $path = __DIR__ . '/../../' . $relativePath;
        self::assertFileExists($path);

        return (string) file_get_contents($path);
    }
}
