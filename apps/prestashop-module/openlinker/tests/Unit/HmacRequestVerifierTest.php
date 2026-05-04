<?php

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for HmacRequestVerifier.
 *
 * Covers all documented failure modes and the happy path. No PS globals required.
 *
 * @see HmacRequestVerifier
 */
class HmacRequestVerifierTest extends TestCase
{
    private const SECRET = 'test-secret-key';
    private const BODY   = '{"event":"product.saved","id":42}';

    private function makeValidTimestamp(): string
    {
        return (string) (int) (microtime(true) * 1000);
    }

    private function makeSignature(string $timestamp, string $body, string $secret = self::SECRET): string
    {
        $payload = $timestamp . '.' . $body;
        return 'sha256=' . hash_hmac('sha256', $payload, $secret);
    }

    // ── Happy path ────────────────────────────────────────────────────────────

    public function testVerifyReturnsTrueForValidRequest(): void
    {
        $ts  = $this->makeValidTimestamp();
        $sig = $this->makeSignature($ts, self::BODY);

        $result = HmacRequestVerifier::verify(self::BODY, $ts, $sig, self::SECRET);

        $this->assertTrue($result);
    }

    // ── Header validation ─────────────────────────────────────────────────────

    public function testVerifyThrowsMissingHeadersWhenTimestampIsNull(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('missing-headers');

        HmacRequestVerifier::verify(self::BODY, null, 'sha256=abc', self::SECRET);
    }

    public function testVerifyThrowsMissingHeadersWhenSignatureIsNull(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('missing-headers');

        HmacRequestVerifier::verify(self::BODY, $this->makeValidTimestamp(), null, self::SECRET);
    }

    // ── Secret validation ─────────────────────────────────────────────────────

    public function testVerifyThrowsMisconfiguredWhenSecretIsEmpty(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('misconfigured');

        $ts = $this->makeValidTimestamp();
        HmacRequestVerifier::verify(self::BODY, $ts, 'sha256=' . str_repeat('a', 64), '');
    }

    // ── Signature format ──────────────────────────────────────────────────────

    public function testVerifyThrowsBadSignatureFormatWhenPrefixMissing(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('bad-signature-format');

        $ts  = $this->makeValidTimestamp();
        $hex = hash_hmac('sha256', $ts . '.' . self::BODY, self::SECRET);
        HmacRequestVerifier::verify(self::BODY, $ts, $hex, self::SECRET); // no 'sha256=' prefix
    }

    public function testVerifyThrowsBadSignatureFormatWhenHexTooShort(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('bad-signature-format');

        HmacRequestVerifier::verify(self::BODY, $this->makeValidTimestamp(), 'sha256=' . str_repeat('a', 32), self::SECRET);
    }

    public function testVerifyThrowsBadSignatureFormatWhenHexTooLong(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('bad-signature-format');

        HmacRequestVerifier::verify(self::BODY, $this->makeValidTimestamp(), 'sha256=' . str_repeat('a', 65), self::SECRET);
    }

    public function testVerifyThrowsBadSignatureFormatWhenHexContainsNonHexChars(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('bad-signature-format');

        $invalidHex = str_repeat('z', 64); // 'z' is not a valid hex char
        HmacRequestVerifier::verify(self::BODY, $this->makeValidTimestamp(), 'sha256=' . $invalidHex, self::SECRET);
    }

    // ── Timestamp / replay window ─────────────────────────────────────────────

    public function testVerifyThrowsTimestampOutOfWindowWhenTimestampIsZero(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('timestamp-out-of-window');

        $sig = $this->makeSignature('0', self::BODY);
        HmacRequestVerifier::verify(self::BODY, '0', $sig, self::SECRET);
    }

    public function testVerifyThrowsTimestampOutOfWindowWhenTimestampIsNegative(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('timestamp-out-of-window');

        $sig = $this->makeSignature('-1000', self::BODY);
        HmacRequestVerifier::verify(self::BODY, '-1000', $sig, self::SECRET);
    }

    public function testVerifyThrowsTimestampOutOfWindowWhenTooOld(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('timestamp-out-of-window');

        // 6 minutes ago — beyond the 5-minute skew window
        $oldTs = (string) ((int) (microtime(true) * 1000) - 360000);
        $sig   = $this->makeSignature($oldTs, self::BODY);
        HmacRequestVerifier::verify(self::BODY, $oldTs, $sig, self::SECRET);
    }

    public function testVerifyThrowsTimestampOutOfWindowWhenTooFarInFuture(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('timestamp-out-of-window');

        // 6 minutes in the future — beyond the 5-minute skew window
        $futureTs = (string) ((int) (microtime(true) * 1000) + 360000);
        $sig      = $this->makeSignature($futureTs, self::BODY);
        HmacRequestVerifier::verify(self::BODY, $futureTs, $sig, self::SECRET);
    }

    // ── Signature integrity ───────────────────────────────────────────────────

    public function testVerifyThrowsInvalidSignatureWhenBodyTampered(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('invalid-signature');

        $ts  = $this->makeValidTimestamp();
        $sig = $this->makeSignature($ts, self::BODY);
        HmacRequestVerifier::verify('{"tampered":true}', $ts, $sig, self::SECRET);
    }

    public function testVerifyThrowsInvalidSignatureWhenTimestampTamperedInHeader(): void
    {
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('invalid-signature');

        $originalTs  = $this->makeValidTimestamp();
        $sig         = $this->makeSignature($originalTs, self::BODY);
        // Attacker changes the header timestamp but reuses the sig computed over originalTs
        $tamperedTs  = (string) ((int) $originalTs - 1000);
        HmacRequestVerifier::verify(self::BODY, $tamperedTs, $sig, self::SECRET);
    }
}
