<?php

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for WebhookSender::fastPathAvailable() (#2624).
 *
 * No Polish host publishes its disabled-function list, so the response-flush
 * fast path must probe rather than assume — and both capability flags matter
 * independently: fastcgi_finish_request is what actually lets the buyer's
 * connection close while PHP keeps running, ignore_user_abort is what keeps
 * PHP running once it does. Either missing means no fast path.
 *
 * @see WebhookSender
 */
class WebhookSenderFastPathTest extends TestCase
{
    public function testAvailableWhenBothFunctionsExist(): void
    {
        $this->assertTrue(WebhookSender::fastPathAvailable(true, true));
    }

    public function testUnavailableWithoutFastcgiFinishRequest(): void
    {
        // The common real-world case: plain mod_php or CLI, where
        // ignore_user_abort exists (core PHP) but fastcgi_finish_request
        // does not (FPM-only).
        $this->assertFalse(WebhookSender::fastPathAvailable(false, true));
    }

    public function testUnavailableWithoutIgnoreUserAbort(): void
    {
        $this->assertFalse(WebhookSender::fastPathAvailable(true, false));
    }

    public function testUnavailableWhenNeitherFunctionExists(): void
    {
        $this->assertFalse(WebhookSender::fastPathAvailable(false, false));
    }

    public function testProbesTheRealRuntimeWhenNoOverrideIsGiven(): void
    {
        // No assertion on the value itself — that depends on the SAPI
        // running this test. Only pins that the no-args call shape (the one
        // every production caller uses) never throws and returns a bool.
        $this->assertIsBool(WebhookSender::fastPathAvailable());
    }
}
