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
            if (!is_numeric($price) || (float) $price < 0) {
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
