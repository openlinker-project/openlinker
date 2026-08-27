<?php

use PHPUnit\Framework\TestCase;

/**
 * Negative tests for the delivery endpoint's token check (#2619).
 *
 * The old check read the token from the query string and compared it with
 * `!==`, so the credential leaked into logs and its prefix leaked through
 * timing. Both halves are pinned here.
 *
 * @see CronTokenVerifier
 */
class CronTokenVerifierTest extends TestCase
{
    public function testReadsTheTokenFromTheHeader(): void
    {
        $presented = CronTokenVerifier::presentedToken(
            ['HTTP_X_OPENLINKER_CRON_TOKEN' => 'abc123'],
            []
        );

        self::assertSame('abc123', $presented);
    }

    public function testReadsTheTokenFromAPostField(): void
    {
        self::assertSame('abc123', CronTokenVerifier::presentedToken([], ['token' => 'abc123']));
    }

    public function testTrimsSurroundingWhitespace(): void
    {
        self::assertSame('abc', CronTokenVerifier::presentedToken([], ['token' => "  abc\n"]));
    }

    public function testPrefersTheHeaderOverThePostField(): void
    {
        $presented = CronTokenVerifier::presentedToken(
            ['HTTP_X_OPENLINKER_CRON_TOKEN' => 'from-header'],
            ['token' => 'from-body']
        );

        self::assertSame('from-header', $presented);
    }

    public function testNeverReadsTheTokenFromTheQueryString(): void
    {
        // $_GET is not a source, so a URL token cannot authenticate a request
        // even when it is the right one.
        $_GET['token'] = 'the-real-token';

        self::assertSame('', CronTokenVerifier::presentedToken([], []));
        self::assertFalse(
            CronTokenVerifier::matches(
                CronTokenVerifier::presentedToken([], []),
                'the-real-token'
            )
        );

        unset($_GET['token']);
    }

    public function testReportsAQueryStringTokenSoTheRefusalCanExplainItself(): void
    {
        self::assertTrue(CronTokenVerifier::hasQueryStringToken(['token' => 'x']));
        self::assertFalse(CronTokenVerifier::hasQueryStringToken(['token' => '']));
        self::assertFalse(CronTokenVerifier::hasQueryStringToken([]));
    }

    public function testMatchesTheConfiguredToken(): void
    {
        self::assertTrue(CronTokenVerifier::matches('abc123', 'abc123'));
    }

    /**
     * @dataProvider refusedPairs
     * @param mixed $presented
     * @param mixed $expected
     */
    public function testRefuses($presented, $expected): void
    {
        self::assertFalse(CronTokenVerifier::matches($presented, $expected));
    }

    public static function refusedPairs(): array
    {
        return [
            'wrong token' => ['nope', 'abc123'],
            'right prefix only' => ['abc', 'abc123'],
            'no token presented' => ['', 'abc123'],
            // An unconfigured shop must not be open to an empty token.
            'nothing configured' => ['', ''],
            'empty configured, token presented' => ['abc123', ''],
            'null presented' => [null, 'abc123'],
        ];
    }
}
