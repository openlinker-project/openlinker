<?php

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for PaymentModuleGate.
 *
 * The inactive case is the one that mattered: it used to reach validateOrder,
 * which answered HTML with status 200 (#2601).
 *
 * @see PaymentModuleGate
 */
class PaymentModuleGateTest extends TestCase
{
    public static function setUpBeforeClass(): void
    {
        if (!class_exists('PaymentModule')) {
            eval('class PaymentModule { public $active = 0; }');
        }
    }

    public function testFalseModuleIsUnavailable(): void
    {
        self::assertSame('payment-module-unavailable', PaymentModuleGate::reasonUnusable(false));
    }

    public function testNullModuleIsUnavailable(): void
    {
        self::assertSame('payment-module-unavailable', PaymentModuleGate::reasonUnusable(null));
    }

    public function testNonPaymentModuleObjectIsUnavailable(): void
    {
        self::assertSame('payment-module-unavailable', PaymentModuleGate::reasonUnusable(new stdClass()));
    }

    public function testInactivePaymentModuleIsRejected(): void
    {
        $module = new PaymentModule();
        $module->active = 0;

        self::assertSame('payment-module-inactive', PaymentModuleGate::reasonUnusable($module));
    }

    public function testActivePaymentModuleIsAccepted(): void
    {
        $module = new PaymentModule();
        $module->active = 1;

        self::assertNull(PaymentModuleGate::reasonUnusable($module));
    }
}
