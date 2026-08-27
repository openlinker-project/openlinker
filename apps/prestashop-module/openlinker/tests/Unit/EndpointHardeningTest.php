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
        // Loose on purpose: a default argument, a differently quoted name or
        // $_REQUEST would all read the same value back out of the URL.
        self::assertDoesNotMatchRegularExpression(
            "/Tools::getValue\(\s*['\"]token|\\\$_GET\s*\[|\\\$_REQUEST\s*\[/",
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

    public function testTheCartShippingPathClaimsAReplayKey(): void
    {
        // cartshipping is signed and state-changing too, so it is guarded on
        // the same terms as order import.
        $source = self::sourceOf('cartshipping');

        $verifyAt = strpos($source, 'HmacRequestVerifier::verify');
        $claimAt = strpos($source, "ReplayGuard::claim('cartshipping'");

        self::assertIsInt($verifyAt);
        self::assertIsInt($claimAt);
        self::assertGreaterThan($verifyAt, $claimAt);
    }

    public function testTheCronPathExplainsTheUrlTokenChangeBeforeCheckingTheMethod(): void
    {
        // An old GET cron carrying &token=... must read why it stopped working,
        // not a bare 405.
        $source = self::sourceOf('cron');

        $explainAt = strpos($source, 'hasQueryStringToken');
        $methodAt = strpos($source, "REQUEST_METHOD'] !== 'POST'");

        self::assertIsInt($explainAt);
        self::assertIsInt($methodAt);
        self::assertLessThan($methodAt, $explainAt);
    }

    public function testTheReplayClaimDoesNotDependOnAMysqlClientFlag(): void
    {
        // ON DUPLICATE KEY UPDATE reports one affected row on a duplicate under
        // CLIENT_FOUND_ROWS, which would accept every replay.
        $source = (string) file_get_contents(__DIR__ . '/../../classes/ReplayGuard.php');

        self::assertStringContainsString('INSERT IGNORE INTO', $source);
        // Matched inside a quoted SQL fragment only, so the docblock is free to
        // name the statement it deliberately does not use.
        self::assertDoesNotMatchRegularExpression(
            "/['\"][^'\"]*ON DUPLICATE KEY UPDATE/",
            $source
        );
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
