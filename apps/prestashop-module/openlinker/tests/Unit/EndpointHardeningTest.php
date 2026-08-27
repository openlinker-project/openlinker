<?php

use PHPUnit\Framework\TestCase;

/**
 * Source-level guards for the four legacy endpoints (#2619).
 *
 * These checks live inside front controllers, which need a PrestaShop runtime
 * to execute, so they are asserted against the source instead. That is enough
 * for what keeps regressing: the check being deleted, or a credential being
 * read back out of the query string.
 */
class EndpointHardeningTest extends TestCase
{
    private const CONTROLLERS = ['cron', 'ping', 'importorder', 'cartshipping'];

    /**
     * @dataProvider controllers
     */
    public function testRejectsTheWrongMethod(string $controller): void
    {
        $source = self::sourceOf($controller);

        self::assertStringContainsString("REQUEST_METHOD'] !== 'POST'", $source);
        self::assertStringContainsString('405', $source);
    }

    /**
     * @dataProvider controllers
     */
    public function testReadsNoCredentialFromTheQueryString(string $controller): void
    {
        $source = self::sourceOf($controller);

        // Tools::getValue falls back to $_GET, so it must not be how a token
        // or a secret is read.
        self::assertDoesNotMatchRegularExpression(
            "/Tools::getValue\('token'\)|\\\$_GET\['token'\]/",
            $source
        );
    }

    public function testTheOrderImportPathClaimsAReplayKey(): void
    {
        $source = self::sourceOf('importorder');

        // The claim must happen after verification, or an unsigned caller could
        // fill the table.
        $verifyAt = strpos($source, 'HmacRequestVerifier::verify');
        $claimAt = strpos($source, 'ReplayGuard::claim');

        self::assertIsInt($verifyAt);
        self::assertIsInt($claimAt);
        self::assertGreaterThan($verifyAt, $claimAt);
    }

    public function testTheConfigurationFormRendersNoStoredCredential(): void
    {
        $template = (string) file_get_contents(
            __DIR__ . '/../../views/templates/admin/configure.tpl'
        );

        self::assertStringNotContainsString('value="{$webhook_secret', $template);
        self::assertStringNotContainsString('value="{$cron_token', $template);
    }

    public static function controllers(): array
    {
        return array_map(static fn (string $name): array => [$name], self::CONTROLLERS);
    }

    private static function sourceOf(string $controller): string
    {
        $path = __DIR__ . '/../../controllers/front/' . $controller . '.php';
        self::assertFileExists($path);

        return (string) file_get_contents($path);
    }
}
