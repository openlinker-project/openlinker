<?php

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the optional `line_prices` field of the order-import payload.
 *
 * Every rejection here is a 400 rather than an order created at the catalogue
 * price, so the negative cases carry the weight (#2597 / ADR-014).
 *
 * @see LinePriceRequest
 */
class LinePriceRequestTest extends TestCase
{
    public function testAcceptsASingleLine(): void
    {
        $rows = LinePriceRequest::normalize([
            ['id_product' => 12, 'id_product_attribute' => 34, 'price' => '9.876543'],
        ]);

        self::assertSame(
            [['id_product' => 12, 'id_product_attribute' => 34, 'price' => '9.876543']],
            $rows
        );
    }

    public function testDefaultsTheAttributeToZeroForASimpleProduct(): void
    {
        $rows = LinePriceRequest::normalize([['id_product' => 5, 'price' => '1.00']]);

        self::assertSame(0, $rows[0]['id_product_attribute']);
    }

    public function testKeepsThePriceAsTheStringItArrivedAs(): void
    {
        $rows = LinePriceRequest::normalize([['id_product' => 5, 'price' => '12.345678']]);

        // A float cast would drop the sixth decimal the backend rounded to.
        self::assertSame('12.345678', $rows[0]['price']);
    }

    public function testAcceptsNumericStringIds(): void
    {
        $rows = LinePriceRequest::normalize([
            ['id_product' => '7', 'id_product_attribute' => '0', 'price' => 2.5],
        ]);

        self::assertSame(7, $rows[0]['id_product']);
        self::assertSame('2.5', $rows[0]['price']);
    }

    public function testAcceptsAZeroPrice(): void
    {
        $rows = LinePriceRequest::normalize([['id_product' => 1, 'price' => '0.000000']]);

        self::assertSame('0.000000', $rows[0]['price']);
    }

    /**
     * @dataProvider unusablePayloads
     * @param mixed $payload
     */
    public function testRejectsAnUnusablePayload($payload): void
    {
        self::assertNull(LinePriceRequest::normalize($payload));
    }

    public static function unusablePayloads(): array
    {
        return [
            'not an array' => ['nope'],
            'empty' => [[]],
            'associative, not a list' => [['a' => ['id_product' => 1, 'price' => '1']]],
            'entry not an array' => [[42]],
            'missing id_product' => [[['price' => '1.00']]],
            'missing price' => [[['id_product' => 1]]],
            'zero id_product' => [[['id_product' => 0, 'price' => '1.00']]],
            'negative id_product' => [[['id_product' => -1, 'price' => '1.00']]],
            'float id_product' => [[['id_product' => 1.5, 'price' => '1.00']]],
            'non-numeric id_product string' => [[['id_product' => '1a', 'price' => '1.00']]],
            'negative attribute' => [[['id_product' => 1, 'id_product_attribute' => -2, 'price' => '1']]],
            'non-numeric price' => [[['id_product' => 1, 'price' => 'free']]],
            'negative price' => [[['id_product' => 1, 'price' => '-0.01']]],
            'one bad line among good ones' => [[
                ['id_product' => 1, 'price' => '1.00'],
                ['id_product' => 2, 'price' => 'oops'],
            ]],
        ];
    }

    public function testRejectsMoreLinesThanTheCap(): void
    {
        $payload = array_fill(0, LinePriceRequest::MAX_LINES + 1, ['id_product' => 1, 'price' => '1']);

        self::assertNull(LinePriceRequest::normalize($payload));
    }

    public function testAcceptsExactlyTheCap(): void
    {
        $payload = array_fill(0, LinePriceRequest::MAX_LINES, ['id_product' => 1, 'price' => '1']);

        self::assertCount(LinePriceRequest::MAX_LINES, (array) LinePriceRequest::normalize($payload));
    }
}
