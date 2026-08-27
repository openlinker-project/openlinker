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

    public function testTheShutdownGuardIsRegisteredBeforeTheFirstPinWrite(): void
    {
        // A fatal inside the pin loop is the one fatal that leaks a
        // specific_price row, so the guard has to be registered above it.
        $source = self::sourceOf('importorder');

        $registerAt = strpos($source, 'register_shutdown_function');
        $pinAt = strpos($source, '$this->pinLinePrices(');

        self::assertIsInt($registerAt);
        self::assertIsInt($pinAt);
        self::assertLessThan($pinAt, $registerAt);
    }

    public function testTheOutputBufferOpensWhereTheGuardIsRegistered(): void
    {
        // A fatal between the registration and the buffer printed unbuffered:
        // the guard reported zero discarded bytes and, once PHP had flushed,
        // headers_sent() made it give up silently and leave an HTML 200.
        $source = self::sourceOf('importorder');

        $registerAt = strpos($source, 'register_shutdown_function');
        $bufferAt = strpos($source, 'ob_start()');
        $pinAt = strpos($source, '$this->pinLinePrices(');

        self::assertIsInt($registerAt);
        self::assertIsInt($bufferAt);
        self::assertLessThan($pinAt, $bufferAt, 'the buffer opens after the pin loop');
        self::assertLessThan($bufferAt, $registerAt);
    }

    /**
     * @dataProvider bufferedEndpoints
     */
    public function testTheEndpointBuffersItsWritesAndGuardsASilentExit(string $endpoint): void
    {
        // Both call sites now require a JSON envelope, so a notice printed in
        // front of one aborts the call. Both endpoints therefore buffer, and
        // both turn a silent exit into a 502 rather than the shop's HTML 200.
        $source = self::sourceOf($endpoint);

        self::assertStringContainsString('ob_start()', $source);
        self::assertStringContainsString('register_shutdown_function', $source);
        self::assertStringContainsString('function guardAgainstSilentExit', $source);
        self::assertStringContainsString('$this->responded = true;', $source);
    }

    /**
     * @dataProvider bufferedEndpoints
     */
    public function testEveryResponderDiscardsTheBufferBeforeEchoing(string $endpoint): void
    {
        // Otherwise the buffered notice is flushed ahead of the envelope, which
        // is the exact body shape the client rejects.
        $source = self::sourceOf($endpoint);

        foreach (['jsonOk', 'jsonError'] as $responder) {
            $at = strpos($source, 'private function ' . $responder . '(');
            self::assertIsInt($at, $responder . ' not found in ' . $endpoint);
            $body = substr($source, $at);
            $discardAt = strpos($body, '$this->discardStrayOutput();');
            $echoAt = strpos($body, 'echo json_encode');
            self::assertIsInt($discardAt, $responder . ' does not discard the buffer');
            self::assertIsInt($echoAt);
            self::assertLessThan($echoAt, $discardAt);
        }
    }

    public static function bufferedEndpoints(): array
    {
        return [['importorder'], ['cartshipping']];
    }

    public function testFailureEnvelopesAdvertiseTheModuleFeatures(): void
    {
        // The backend learns what this build accepts from `features`. Carrying
        // it on failures too means a downgraded shop is corrected without an
        // order having to be created first.
        $source = self::sourceOf('importorder');

        self::assertMatchesRegularExpression(
            "/'ok' => false.*'features' => \['line_prices'\]/s",
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
