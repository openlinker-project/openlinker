<?php

use PHPUnit\Framework\TestCase;

/**
 * The configuration form must never render a stored credential (#2619), and a
 * blank field must not wipe one.
 *
 * @see SecretDisplay
 */
class SecretDisplayTest extends TestCase
{
    public function testHintsWithAShortPrefixOnly(): void
    {
        self::assertSame('a1b2...', SecretDisplay::hint('a1b2c3d4e5f6g7h8'));
    }

    public function testHintsNothingWhenNothingIsStored(): void
    {
        self::assertSame('', SecretDisplay::hint(''));
        self::assertSame('', SecretDisplay::hint(null));
    }

    public function testWillNotPrintMostOfAShortSecret(): void
    {
        self::assertSame('(set)', SecretDisplay::hint('short'));
    }

    public function testABlankFieldKeepsTheStoredValue(): void
    {
        self::assertNull(SecretDisplay::resolveSubmitted('', 'stored-secret'));
        self::assertNull(SecretDisplay::resolveSubmitted('   ', 'stored-secret'));
        self::assertNull(SecretDisplay::resolveSubmitted(null, 'stored-secret'));
    }

    public function testAnUnchangedValueIsNotRewritten(): void
    {
        self::assertNull(SecretDisplay::resolveSubmitted('stored-secret', 'stored-secret'));
    }

    public function testANewValueReplacesTheStoredOne(): void
    {
        self::assertSame('new-secret', SecretDisplay::resolveSubmitted('new-secret', 'old-secret'));
    }

    public function testAFirstValueIsAccepted(): void
    {
        self::assertSame('first', SecretDisplay::resolveSubmitted('first', ''));
    }
}
