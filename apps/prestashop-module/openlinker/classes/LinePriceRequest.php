<?php
/**
 * Line Price Request
 *
 * Validates and normalises the optional `line_prices` field of the order-import
 * payload (#2597).
 *
 * The OpenLinker backend used to pin each line's buyer-paid price with one
 * `POST /specific_prices` and one `DELETE` per line over the Webservice. On an
 * eight-line order that was sixteen of twenty-seven requests. That resource has
 * no bulk write, so the only way to collapse it is to hand the whole set to the
 * module in the request that already creates the order.
 *
 * The prices arrive tax-EXCLUSIVE and per unit, already converted by the
 * backend, which owns the tax-rate resolution and the rounding mode. This class
 * checks the shape only - it never computes a price.
 *
 * @module prestashop-module/classes
 */

class LinePriceRequest
{
    /** Largest number of lines accepted in one request. */
    const MAX_LINES = 500;

    /**
     * Normalise the raw `line_prices` value into rows the controller can insert.
     *
     * Returns null when the value is unusable. The caller answers 400 on null
     * rather than importing the order, because a malformed price set would let
     * the order be created at the catalogue price - a wrong order is worse than
     * no order (ADR-014).
     *
     * @param mixed $raw
     * @return array<int, array{id_product: int, id_product_attribute: int, price: string}>|null
     */
    public static function normalize($raw)
    {
        if (!is_array($raw) || $raw === [] || array_keys($raw) !== range(0, count($raw) - 1)) {
            return null;
        }

        if (count($raw) > self::MAX_LINES) {
            return null;
        }

        $rows = [];
        foreach ($raw as $entry) {
            if (!is_array($entry) || !isset($entry['id_product']) || !isset($entry['price'])) {
                return null;
            }

            $idProduct = $entry['id_product'];
            $idAttribute = isset($entry['id_product_attribute']) ? $entry['id_product_attribute'] : 0;
            $price = $entry['price'];

            if (!self::isNonNegativeInteger($idProduct) || (int) $idProduct <= 0) {
                return null;
            }
            if (!self::isNonNegativeInteger($idAttribute)) {
                return null;
            }
            if (!self::isDecimalAmount($price)) {
                return null;
            }

            $rows[] = [
                'id_product' => (int) $idProduct,
                'id_product_attribute' => (int) $idAttribute,
                // Kept as the string the backend sent so its rounding survives
                // the trip. A float cast here would re-round the sixth decimal.
                'price' => (string) $price,
            ];
        }

        return $rows;
    }

    /**
     * Check that every cart line has exactly one supplied price, and that no
     * supplied price names a line the cart does not have.
     *
     * An omitted line is the worst outcome on this path: it is ordered at the
     * catalogue price with no error at all, which is the failure ADR-014 exists
     * to prevent. Pure, so it is testable without a cart object.
     *
     * @param array<int, array{id_product: int, id_product_attribute: int, price: string}> $rows
     * @param array<int, array<string, mixed>> $cartProducts Rows from Cart::getProducts().
     * @return bool
     */
    public static function coversCart(array $rows, array $cartProducts)
    {
        $supplied = [];
        foreach ($rows as $row) {
            $key = $row['id_product'] . ':' . $row['id_product_attribute'];
            if (isset($supplied[$key])) {
                return false;
            }
            $supplied[$key] = true;
        }

        foreach ($cartProducts as $product) {
            $idProduct = isset($product['id_product']) ? (int) $product['id_product'] : 0;
            $idAttribute = isset($product['id_product_attribute'])
                ? (int) $product['id_product_attribute']
                : 0;
            $key = $idProduct . ':' . $idAttribute;

            if (!isset($supplied[$key])) {
                return false;
            }
            unset($supplied[$key]);
        }

        // Anything left over names a line that is not in the cart, so the
        // backend and the shop disagree about what is being sold.
        return $supplied === [];
    }

    /**
     * Check a price is a plain decimal amount.
     *
     * is_numeric would accept '1e5', which reaches a decimal(20,6) column as
     * 100000, and leading whitespace. The column keeps six decimals, so more
     * than six would be silently rounded by MySQL rather than by the backend
     * that owns the rounding mode.
     *
     * @param mixed $value
     * @return bool
     */
    private static function isDecimalAmount($value)
    {
        if (is_int($value) || is_float($value)) {
            return $value >= 0;
        }

        return is_string($value) && preg_match('/^\d+(\.\d{1,6})?$/', $value) === 1;
    }

    /**
     * @param mixed $value
     * @return bool
     */
    private static function isNonNegativeInteger($value)
    {
        if (is_int($value)) {
            return $value >= 0;
        }

        // A JSON body can carry an id as a string; a float cannot be an id.
        return is_string($value) && preg_match('/^\d+$/', $value) === 1;
    }
}
