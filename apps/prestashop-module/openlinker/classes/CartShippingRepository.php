<?php
/**
 * Cart Shipping Repository
 *
 * Sidecar I/O for the OpenLinker dynamic shipping carrier. Stores per-cart
 * shipping cost (tax-excl + tax-incl + source) keyed by id_cart, written by
 * the OL backend before the cart is converted to an order, and read by the
 * carrier module's getOrderShippingCostExternal() at order-create time.
 *
 * The OL-supplied amount_tax_incl is treated as authoritative — see the
 * id_tax_rules_group=0 setting in OpenLinker::installDynamicCarrier() to
 * understand why PS must NOT add tax on top.
 *
 * @module prestashop-module/classes
 * @see {@link OpenLinker::getOrderShippingCostExternal} for the read path
 * @see controllers/front/cartshipping.php for the HMAC-authed write endpoint
 */

class CartShippingRepository
{
    /** @var string Fully-qualified table name (with PS DB prefix). */
    private $tableName;

    public function __construct()
    {
        $this->tableName = _DB_PREFIX_ . 'openlinker_cart_shipping';
    }

    /**
     * Find the sidecar row for a given cart, if any.
     *
     * @param int $idCart
     * @return array|null  Associative row or null when no row exists.
     *                     Returned columns: amount_tax_excl, amount_tax_incl, source.
     */
    public function findByCartId($idCart)
    {
        $idCart = (int) $idCart;
        if ($idCart <= 0) {
            return null;
        }

        $sql = 'SELECT amount_tax_excl, amount_tax_incl, source
                FROM `' . $this->tableName . '`
                WHERE id_cart = ' . $idCart;

        $row = Db::getInstance()->getRow($sql);
        return ($row !== false && $row !== null && is_array($row)) ? $row : null;
    }

    /**
     * Idempotent upsert by id_cart. Re-calling with the same arguments leaves
     * the DB in the same state (modulo updated_at).
     *
     * All numeric inputs are cast to int/float at the boundary; the only
     * string field (source) is escaped via pSQL(). No caller body is
     * interpolated raw into the SQL.
     *
     * @param int         $idCart
     * @param float       $amountTaxExcl
     * @param float       $amountTaxIncl
     * @param string|null $source         Free-text label for diagnostic purposes
     *                                    (e.g. 'allegro:order:12345')
     * @return bool                       true on successful execute
     */
    public function upsert($idCart, $amountTaxExcl, $amountTaxIncl, $source = null)
    {
        $idCart  = (int) $idCart;
        $taxExcl = (float) $amountTaxExcl;
        $taxIncl = (float) $amountTaxIncl;
        $sourceSql = ($source === null || $source === '')
            ? 'NULL'
            : "'" . pSQL((string) $source) . "'";

        $sql = 'INSERT INTO `' . $this->tableName . '`
                  (id_cart, amount_tax_excl, amount_tax_incl, source)
                VALUES
                  (' . $idCart . ', ' . $taxExcl . ', ' . $taxIncl . ', ' . $sourceSql . ')
                ON DUPLICATE KEY UPDATE
                  amount_tax_excl = VALUES(amount_tax_excl),
                  amount_tax_incl = VALUES(amount_tax_incl),
                  source          = VALUES(source),
                  updated_at      = CURRENT_TIMESTAMP';

        return (bool) Db::getInstance()->execute($sql);
    }
}
