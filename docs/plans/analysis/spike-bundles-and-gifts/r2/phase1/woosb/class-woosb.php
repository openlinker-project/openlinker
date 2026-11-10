<?php
declare( strict_types=1 );
defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'WPCleverWoosb' ) && class_exists( 'WC_Product' ) ) {
    class WPCleverWoosb {
        protected static $instance = null;
        protected $helper = null;

        public static function instance() {
            if ( is_null( self::$instance ) ) {
                self::$instance = new self();
            }

            return self::$instance;
        }

        function __construct() {
            // Cache helper instance
            $this->helper = WPCleverWoosb_Helper();

            // Init
            add_action( 'init', [ $this, 'init' ] );

            // Add image to variation
            add_filter( 'woocommerce_available_variation', [ $this, 'available_variation' ], 10, 3 );

            // Enqueue frontend scripts
            add_action( 'wp_enqueue_scripts', [ $this, 'enqueue_scripts' ] );

            // Product tab
            if ( ( $this->helper->get_setting( 'bundled_position', 'above' ) === 'tab' ) || ( $this->helper->get_setting( 'bundles_position', 'no' ) === 'tab' ) ) {
                add_filter( 'woocommerce_product_tabs', [ $this, 'product_tabs' ] );
            }

            // Bundled products position
            switch ( $this->helper->get_setting( 'bundled_position', 'above' ) ) {
                case 'below_title':
                    add_action( 'woocommerce_single_product_summary', [ $this, 'product_summary_bundled' ], 6 );
                    break;
                case 'below_price':
                    add_action( 'woocommerce_single_product_summary', [ $this, 'product_summary_bundled' ], 11 );
                    break;
                case 'below_excerpt':
                    add_action( 'woocommerce_single_product_summary', [ $this, 'product_summary_bundled' ], 21 );
                    break;
            }

            // Bundles position
            switch ( $this->helper->get_setting( 'bundles_position', 'no' ) ) {
                case 'above':
                    add_action( 'woocommerce_single_product_summary', [ $this, 'product_summary_bundles' ], 29 );
                    break;
                case 'below':
                    add_action( 'woocommerce_single_product_summary', [ $this, 'product_summary_bundles' ], 31 );
                    break;
            }

            // Product price class
            add_filter( 'woocommerce_product_price_class', [ $this, 'product_price_class' ] );

            // Add-to-cart form & button
            add_action( 'woocommerce_woosb_add_to_cart', [ $this, 'add_to_cart_form' ] );
            add_action( 'woocommerce_before_add_to_cart_button', [ $this, 'add_to_cart_button' ] );

            // Add to cart
            add_filter( 'woocommerce_add_to_cart_sold_individually_found_in_cart', [ $this, 'found_in_cart' ], 10, 2 );
            add_filter( 'woocommerce_add_to_cart_validation', [ $this, 'add_to_cart_validation' ], 10, 3 );
            add_filter( 'woocommerce_add_cart_item_data', [ $this, 'add_cart_item_data' ], 10, 2 );
            add_action( 'woocommerce_add_to_cart', [ $this, 'add_to_cart' ], 10, 6 );
            add_filter( 'woocommerce_get_cart_item_from_session', [ $this, 'get_cart_item_from_session' ], 10, 2 );

            // Cart item
            add_filter( 'woocommerce_cart_item_name', [ $this, 'cart_item_name' ], 10, 2 );
            add_action( 'woocommerce_after_cart_item_name', [ $this, 'cart_item_edit' ], 10, 2 );
            add_filter( 'woocommerce_cart_item_quantity', [ $this, 'cart_item_quantity' ], 10, 3 );
            add_filter( 'woocommerce_cart_item_remove_link', [ $this, 'cart_item_remove_link' ], 10, 2 );
            add_filter( 'woocommerce_cart_contents_count', [ $this, 'cart_contents_count' ] );
            add_action( 'woocommerce_cart_item_removed', [ $this, 'cart_item_removed' ], 10, 2 );
            add_filter( 'woocommerce_cart_item_price', [ $this, 'cart_item_price' ], 9999, 2 );
            add_filter( 'woocommerce_cart_item_subtotal', [ $this, 'cart_item_subtotal' ], 9999, 2 );

            // Order
            add_filter( 'woocommerce_get_item_count', [ $this, 'get_item_count' ], 10, 3 );

            // Mini cart item visible
            add_filter( 'woocommerce_widget_cart_item_visible', [ $this, 'mini_cart_item_visible' ], 10, 2 );

            // Cart item visible
            add_filter( 'woocommerce_cart_item_visible', [ $this, 'cart_item_visible' ], 10, 2 );
            add_filter( 'woocommerce_checkout_cart_item_visible', [ $this, 'cart_item_visible' ], 10, 2 );

            // Order item visible
            add_filter( 'woocommerce_order_item_visible', [ $this, 'order_item_visible' ], 10, 2 );

            // Item class
            if ( $this->helper->get_setting( 'hide_bundled', 'no' ) !== 'yes' ) {
                add_filter( 'woocommerce_cart_item_class', [ $this, 'cart_item_class' ], 10, 2 );
                add_filter( 'woocommerce_mini_cart_item_class', [ $this, 'cart_item_class' ], 10, 2 );
                add_filter( 'woocommerce_order_item_class', [ $this, 'cart_item_class' ], 10, 2 );
            }

            // Get item data
            if ( $this->helper->get_setting( 'hide_bundled', 'no' ) === 'yes_text' || $this->helper->get_setting( 'hide_bundled', 'no' ) === 'yes_list' ) {
                add_filter( 'woocommerce_get_item_data', [ $this, 'cart_item_meta' ], 10, 2 );
            }

            // Order item
            add_action( 'woocommerce_checkout_create_order_line_item', [ $this, 'create_order_line_item' ], 10, 3 );
            add_filter( 'woocommerce_order_item_name', [ $this, 'cart_item_name' ], 10, 2 );
            add_filter( 'woocommerce_order_formatted_line_subtotal', [ $this, 'formatted_line_subtotal' ], 10, 2 );

            if ( $this->helper->get_setting( 'hide_bundled_order', 'no' ) === 'yes_text' || $this->helper->get_setting( 'hide_bundled_order', 'no' ) === 'yes_list' ) {
                // Hide bundled products, just show the main product on order details (order confirmation or emails)
                add_action( 'woocommerce_order_item_meta_start', [ $this, 'order_item_meta_start' ], 10, 2 );
            }

            // Undo remove
            add_action( 'woocommerce_restore_cart_item', [ $this, 'restore_cart_item' ] );

            // Loop add-to-cart
            add_filter( 'woocommerce_loop_add_to_cart_link', [ $this, 'loop_add_to_cart_link' ], 99, 2 );

            // Before calculate totals
            add_action( 'woocommerce_before_mini_cart_contents', [ $this, 'before_mini_cart_contents' ], 9999 );
            add_action( 'woocommerce_before_calculate_totals', [ $this, 'before_calculate_totals' ], 9999 );

            // Shipping
            add_filter( 'woocommerce_cart_shipping_packages', [ $this, 'cart_shipping_packages' ], 9 );
            add_filter( 'woocommerce_cart_contents_weight', [ $this, 'cart_contents_weight' ], 9 );

            // Price HTML
            add_filter( 'woocommerce_get_price_html', [ $this, 'get_price_html' ], 99, 2 );

            // Order again
            add_filter( 'woocommerce_order_again_cart_item_data', [ $this, 'order_again_cart_item_data' ], 10, 2 );
            add_action( 'woocommerce_cart_loaded_from_session', [ $this, 'cart_loaded_from_session' ] );

            // Coupons
            add_filter( 'woocommerce_coupon_is_valid_for_product', [ $this, 'coupon_is_valid_for_product' ], 10, 4 );

            // Update stock status
            add_action( 'woocommerce_product_set_stock_status', [ $this, 'update_stock_status' ], 10, 3 );
            add_action( 'woocommerce_variation_set_stock_status', [ $this, 'update_stock_status' ], 10, 3 );

            // Update bundle price when a child product price changes
            add_action( 'woocommerce_update_product', [ $this, 'update_bundle_price_on_product_save' ] );
            add_action( 'woocommerce_update_product_variation', [ $this, 'update_bundle_price_on_variation_save' ] );
        }

        function init() {

            // shortcode
            add_shortcode( 'woosb_form', [ $this, 'shortcode_form' ] );
            add_shortcode( 'woosb_bundled', [ $this, 'shortcode_bundled' ] );
            add_shortcode( 'woosb_bundles', [ $this, 'shortcode_bundles' ] );
        }

        function available_variation( $data, $variable, $variation ) {
            if ( apply_filters( 'woosb_add_variation_image', true ) && ( $image_id = $variation->get_image_id() ) ) {
                $data['woosb_image'] = wp_get_attachment_image( $image_id, $this->helper::get_image_size() );
            }

            return $data;
        }

        function enqueue_scripts() {
            wp_enqueue_style( 'woosb-frontend', WOOSB_URI . 'assets/css/frontend.css', [], WOOSB_VERSION );
            wp_enqueue_script( 'woosb-frontend', WOOSB_URI . 'assets/js/frontend.js', [ 'jquery' ], WOOSB_VERSION, true );
            wp_localize_script(
                    'woosb-frontend',
                    'woosb_vars',
                    apply_filters( 'woosb_vars', [
                            'wc_price_decimals'           => wc_get_price_decimals(),
                            'wc_price_format'             => get_woocommerce_price_format(),
                            'wc_price_thousand_separator' => wc_get_price_thousand_separator(),
                            'wc_price_decimal_separator'  => wc_get_price_decimal_separator(),
                            'wc_currency_symbol'          => get_woocommerce_currency_symbol(),
                            'price_decimals'              => apply_filters( 'woosb_price_decimals', wc_get_price_decimals() ),
                            'price_format'                => get_woocommerce_price_format(),
                            'price_thousand_separator'    => wc_get_price_thousand_separator(),
                            'price_decimal_separator'     => wc_get_price_decimal_separator(),
                            'currency_symbol'             => get_woocommerce_currency_symbol(),
                            'trim_zeros'                  => apply_filters( 'woosb_price_trim_zeros', apply_filters( 'woocommerce_price_trim_zeros', false ) ),
                            'round_price'                 => apply_filters( 'woosb_round_price', ! apply_filters( 'woosb_ignore_round_price', false ) ),
                            'recalc_price'                => apply_filters( 'woosb_recalc_price', false ),
                            'change_image'                => $this->helper->get_setting( 'change_image', 'yes' ),
                            'bundled_price'               => $this->helper->get_setting( 'bundled_price', 'price' ),
                            'bundled_price_from'          => $this->helper->get_setting( 'bundled_price_from', 'sale_price' ),
                            'change_price'                => $this->helper->get_setting( 'change_price', 'yes' ),
                            'price_selector'              => $this->helper->get_setting( 'change_price_custom', '' ),
                            'saved_text'                  => $this->helper->localization( 'saved', esc_html__( '(saved [d])', 'woo-product-bundle' ) ),
                            'price_text'                  => $this->helper->localization( 'total', esc_html__( 'Bundle price:', 'woo-product-bundle' ) ),
                            'selected_text'               => $this->helper->localization( 'selected', esc_html__( 'Selected:', 'woo-product-bundle' ) ),
                            'alert_selection'             => $this->helper->localization( 'alert_selection', esc_html__( 'Please select a purchasable variation for [name] before adding this bundle to the cart.', 'woo-product-bundle' ) ),
                            'alert_unpurchasable'         => $this->helper->localization( 'alert_unpurchasable', esc_html__( 'Product [name] is unpurchasable. Please remove it before adding the bundle to the cart.', 'woo-product-bundle' ) ),
                            'alert_empty'                 => $this->helper->localization( 'alert_empty', esc_html__( 'Please choose at least one product before adding this bundle to the cart.', 'woo-product-bundle' ) ),
                            'alert_min'                   => $this->helper->localization( 'alert_min', esc_html__( 'Please choose at least a total quantity of [min] products before adding this bundle to the cart.', 'woo-product-bundle' ) ),
                            'alert_max'                   => $this->helper->localization( 'alert_max', esc_html__( 'Sorry, you can only choose at max a total quantity of [max] products before adding this bundle to the cart.', 'woo-product-bundle' ) ),
                            'alert_total_min'             => $this->helper->localization( 'alert_total_min', esc_html__( 'The total must meet the minimum amount of [min].', 'woo-product-bundle' ) ),
                            'alert_total_max'             => $this->helper->localization( 'alert_total_max', esc_html__( 'The total must meet the maximum amount of [max].', 'woo-product-bundle' ) ),
                    ] )
            );
        }

        function cart_contents_count( $count ) {
            // count for cart contents
            $cart_count = $this->helper->get_setting( 'cart_contents_count', 'bundle' );

            if ( $cart_count !== 'both' ) {
                foreach ( WC()->cart->get_cart() as $cart_item ) {
                    if ( ( $cart_count === 'bundled_products' ) && ! empty( $cart_item['woosb_ids'] ) ) {
                        $count -= $cart_item['quantity'];
                    }

                    if ( ( $cart_count === 'bundle' ) && ! empty( $cart_item['woosb_parent_id'] ) ) {
                        $count -= $cart_item['quantity'];
                    }
                }
            }

            return apply_filters( 'woosb_cart_contents_count', $count );
        }

        function get_item_count( $count, $type, $order ) {
            // count for order items
            $cart_count    = $this->helper->get_setting( 'cart_contents_count', 'bundle' );
            $order_bundles = $order_bundled = 0;

            if ( $cart_count !== 'both' ) {
                $order_items = $order->get_items( 'line_item' );

                foreach ( $order_items as $order_item ) {
                    if ( $order_item->get_meta( '_woosb_parent_id' ) ) {
                        $order_bundled += $order_item->get_quantity();
                    }

                    if ( $order_item->get_meta( '_woosb_ids' ) ) {
                        $order_bundles += $order_item->get_quantity();
                    }
                }

                if ( ( $cart_count === 'bundled_products' ) && ( $order_bundled > 0 ) ) {
                    return $count - $order_bundles;
                }

                if ( ( $cart_count === 'bundle' ) && ( $order_bundles > 0 ) ) {
                    return $count - $order_bundled;
                }
            }

            return apply_filters( 'woosb_get_item_count', $count );
        }

        function cart_item_name( $name, $item ) {
            if ( empty( $item['woosb_parent_id'] ) ) {
                return $name;
            }

            $show_bundle_name = $this->helper->get_setting( 'hide_bundle_name', 'no' ) === 'no';
            $parent_id        = apply_filters( 'woosb_item_id', $item['woosb_parent_id'] );

            if ( ( str_contains( $name, '</a>' ) ) && ( $this->helper->get_setting( 'bundled_link', 'yes' ) !== 'no' ) ) {
                if ( $show_bundle_name ) {
                    $_name = '<a href="' . esc_url( get_permalink( $parent_id ) ) . '">' . esc_html( get_the_title( $parent_id ) ) . '</a>' . apply_filters( 'woosb_name_separator', ' &rarr; ' ) . apply_filters( 'woosb_item_product_name', $name, $item );
                } else {
                    $_name = apply_filters( 'woosb_item_product_name', $name, $item );
                }
            } else {
                if ( $show_bundle_name ) {
                    $_name = esc_html( get_the_title( $parent_id ) ) . apply_filters( 'woosb_name_separator', ' &rarr; ' ) . wp_strip_all_tags( apply_filters( 'woosb_item_product_name', $name, $item ) );
                } else {
                    $_name = wp_strip_all_tags( apply_filters( 'woosb_item_product_name', $name, $item ) );
                }
            }

            return apply_filters( 'woosb_cart_item_name', $_name, $name, $item );
        }

        function cart_item_edit( $cart_item, $cart_item_key ) {
            $edit_link = $this->helper->get_setting( 'edit_link', 'no' ) === 'yes';

            if ( ! $edit_link ) {
                return;
            }

            if ( ! empty( $cart_item['woosb_ids'] ) && is_a( $cart_item['data'], 'WC_Product_Woosb' ) ) {
                $base_product = new WC_Product_Woosb( $cart_item['product_id'] );

                if ( $base_product->has_optional() || $base_product->has_variables() ) {
                    $edit_url  = apply_filters( 'woosb_cart_item_edit_url', add_query_arg( [
                            'edit' => base64_encode( $cart_item['woosb_ids'] ),
                            'key'  => $cart_item_key
                    ], $cart_item['data']->get_permalink() ), $cart_item, $cart_item_key );
                    $edit_link = ' <a class="woosb-cart-item-edit" href="' . esc_url( $edit_url ) . '">' . esc_html( $this->helper->localization( 'cart_item_edit', esc_html__( 'Edit', 'woo-product-bundle' ) ) ) . '</a>';

                    echo apply_filters( 'woosb_cart_item_edit_link', $edit_link, $cart_item, $cart_item_key );
                }
            }
        }

        function cart_item_removed( $cart_item_key, $cart ) {
            $removed_item = $cart->removed_cart_contents[ $cart_item_key ] ?? null;

            // Remove all items in the same bundle by bundle_id if available
            $bundle_id = $this->helper->get_bundle_id( $removed_item );

            if ( ! empty( $bundle_id ) ) {
                foreach ( $this->helper->get_bundle_cart_keys( $cart->cart_contents, $bundle_id ) as $other_key ) {
                    WC()->cart->remove_cart_item( $other_key );
                }

                // The bundle is fully handled by bundle_id, stored parent/child keys can be stale (e.g. WPML re-keying)
                return;
            }

            $new_keys = [];

            foreach ( $cart->cart_contents as $cart_key => $cart_item ) {
                if ( ! empty( $cart_item['woosb_key'] ) ) {
                    $new_keys[ $cart_key ] = $cart_item['woosb_key'];
                }
            }

            if ( isset( $cart->removed_cart_contents[ $cart_item_key ]['woosb_keys'] ) ) {
                // remove all bundled sub-products when removing the main bundle
                $keys = $cart->removed_cart_contents[ $cart_item_key ]['woosb_keys'];

                foreach ( $keys as $key ) {
                    WC()->cart->remove_cart_item( $key );

                    if ( $new_key = array_search( $key, $new_keys ) ) {
                        WC()->cart->remove_cart_item( $new_key );
                    }
                }
            }

            if ( isset( $cart->removed_cart_contents[ $cart_item_key ]['woosb_parent_key'] ) ) {
                // remove the main bundle when removing any bundled sub-product
                $parent_key = $cart->removed_cart_contents[ $cart_item_key ]['woosb_parent_key'];

                WC()->cart->remove_cart_item( $parent_key );
            }
        }

        function check_in_cart( $product_id ) {
            foreach ( WC()->cart->get_cart() as $cart_item ) {
                if ( $cart_item['product_id'] == $product_id ) {
                    return true;
                }
            }

            return false;
        }

        function found_in_cart( $found_in_cart, $product_id ) {
            if ( apply_filters( 'woosb_sold_individually_found_in_cart', true ) && self::check_in_cart( $product_id ) ) {
                return true;
            }

            return $found_in_cart;
        }

        function add_to_cart_validation( $passed, $product_id, $qty ) {
            if ( ! apply_filters( 'woosb_add_to_cart_validation', true ) || isset( $_REQUEST['order_again'] ) ) {
                return $passed;
            }

            if ( ( $product = wc_get_product( $product_id ) ) && is_a( $product, 'WC_Product_Woosb' ) ) {
                // get settings before re-building items
                $has_optional  = $product->has_optional();
                $has_variables = $product->has_variables();

                // get original items for validating
                $ori_items = $product->get_items();
                $ori_ids   = array_filter( array_column( $ori_items, 'id' ) );

                if ( isset( $_REQUEST['woosb_ids'] ) ) {
                    $ids = $this->helper->clean_ids( wp_unslash( $_REQUEST['woosb_ids'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
                    $product->build_items( $ids );
                }

                if ( ( $items = $product->get_items() ) && ! empty( $items ) ) {
                    $count                 = $total = $purchasable = 0;
                    $min_whole             = (float) ( $product->get_meta( 'woosb_limit_whole_min' ) ?: 1 );
                    $max_whole             = (float) ( $product->get_meta( 'woosb_limit_whole_max' ) ?: - 1 );
                    $total_min             = (float) ( $product->get_meta( 'woosb_total_limits_min' ) ?: 0 );
                    $total_max             = (float) ( $product->get_meta( 'woosb_total_limits_max' ) ?: - 1 );
                    $total_limits          = $product->get_meta( 'woosb_total_limits' ) === 'on';
                    $check_total           = ! $product->is_fixed_price() && ( $has_optional || $has_variables ) && $total_limits;
                    $exclude_unpurchasable = $product->exclude_unpurchasable();

                    foreach ( $items as $key => $item ) {
                        $_id = $item['id'];

                        if ( ! $_id ) {
                            // exclude heading/paragraph
                            continue;
                        }

                        $_qty     = $item['qty'];
                        $count    += $_qty;
                        $_parent  = 0;
                        $_product = wc_get_product( $_id );

                        if ( ! $_product ) {
                            if ( ! $exclude_unpurchasable ) {
                                wc_add_notice( esc_html__( 'One of the bundled products is unavailable.', 'woo-product-bundle' ), 'error' );
                                wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                                return false;
                            } else {
                                continue;
                            }
                        }

                        if ( $check_total ) {
                            $total += wc_get_price_to_display( $_product, [ 'qty' => $_qty ] );
                        }

                        if ( $_product->is_type( 'variation' ) ) {
                            $_parent = $_product->get_parent_id();
                        }

                        if ( ! function_exists( 'wpml_loaded' ) ) {
                            // don't check it with wpml
                            $ori_item_id = isset( $ori_items[ $key ]['id'] ) ? (int) $ori_items[ $key ]['id'] : 0;

                            if ( ! isset( $ori_items[ $key ] ) || ( $ori_item_id !== (int) $_id && $ori_item_id !== $_parent ) ) {
                                wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                                return false;
                            }
                        }

                        // validate qty
                        if ( ! isset( $ori_items[ $key ] ) ) {
                            // key doesn't exist in original items, already handled above for non-WPML
                            continue;
                        }

                        if ( ! empty( $ori_items[ $key ]['optional'] ) ) {
                            $_min = ! empty( $ori_items[ $key ]['min'] ) ? (float) $ori_items[ $key ]['min'] : 0;
                            $_max = ! empty( $ori_items[ $key ]['max'] ) ? (float) $ori_items[ $key ]['max'] : 10000;

                            if ( $_qty < $_min || $_qty > $_max ) {
                                wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                                return false;
                            }
                        } else {
                            if ( (float) $_qty !== (float) $ori_items[ $key ]['qty'] ) {
                                wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                                return false;
                            }
                        }

                        if ( ! $exclude_unpurchasable ) {
                            if ( $_product->is_type( 'variable' ) || $_product->is_type( 'woosb' ) || ! $_product->is_in_stock() || ! $this->helper->is_purchasable( $_product, 'validation' ) ) {
                                /* translators: product name */
                                wc_add_notice( sprintf( esc_html__( '"%s" is un-purchasable.', 'woo-product-bundle' ), esc_html( $_product->get_name() ) ), 'error' );
                                wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                                return false;
                            }

                            if ( $_product->is_sold_individually() && apply_filters( 'woosb_sold_individually_found_in_cart', true ) && self::check_in_cart( $_id ) ) {
                                /* translators: product name */
                                wc_add_notice( sprintf( esc_html__( 'You cannot add another "%s" to the cart.', 'woo-product-bundle' ), esc_html( $_product->get_name() ) ), 'error' );
                                wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                                return false;
                            }

                            if ( post_password_required( $_id ) ) {
                                /* translators: product name */
                                wc_add_notice( sprintf( esc_html__( '"%s" is protected and cannot be purchased.', 'woo-product-bundle' ), esc_html( $_product->get_name() ) ), 'error' );
                                wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                                return false;
                            }

                            if ( $_product->managing_stock() ) {
                                $qty_in_cart  = ( method_exists( WC()->cart, 'get_cart_item_quantities' ) ) && ( $quantities = WC()->cart->get_cart_item_quantities() ) && method_exists( $_product, 'get_stock_managed_by_id' ) && isset( $quantities[ $_product->get_stock_managed_by_id() ] ) ? $quantities[ $_product->get_stock_managed_by_id() ] : 0;
                                $qty_to_check = 0;

                                // use already-fetched $items instead of calling get_items() again
                                foreach ( $items as $_item ) {
                                    if ( (int) $_item['id'] === (int) $_id ) {
                                        $qty_to_check += $_item['qty'];
                                    }
                                }

                                if ( ! $_product->has_enough_stock( $qty_in_cart + $qty_to_check * $qty ) ) {
                                    /* translators: product name */
                                    wc_add_notice( sprintf( esc_html__( '"%s" has not enough stock.', 'woo-product-bundle' ), esc_html( $_product->get_name() ) ), 'error' );
                                    wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                                    return false;
                                }
                            }
                        }

                        $purchasable ++;
                    }

                    if ( ! $purchasable || ( $purchasable > count( $ori_ids ) ) ) {
                        wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                        return false;
                    }

                    if ( ! $exclude_unpurchasable && ! $has_optional && ( $purchasable < count( $ori_ids ) ) ) {
                        wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                        return false;
                    }

                    // validate that all required (non-optional) items are present in submitted items
                    if ( $has_optional ) {
                        foreach ( $ori_items as $ori_key => $ori_item ) {
                            if ( empty( $ori_item['id'] ) || ! empty( $ori_item['optional'] ) ) {
                                // skip heading/paragraph and optional items
                                continue;
                            }

                            // required item must exist with the exact same key
                            if ( ! isset( $items[ $ori_key ] ) ) {
                                wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                                return false;
                            }
                        }
                    }

                    if ( $has_optional && ( ( $min_whole > 0 && $count < $min_whole ) || ( $max_whole > 0 && $count > $max_whole ) ) ) {
                        wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                        return false;
                    }

                    if ( $check_total ) {
                        if ( $discount_amount = $product->get_discount_amount() ) {
                            $total -= $discount_amount;
                        } elseif ( $discount_percentage = $product->get_discount_percentage() ) {
                            $total = $total * ( 100 - $discount_percentage ) / 100;
                        }

                        if ( $total_min > 0 && $total < $total_min ) {
                            wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                            return false;
                        }

                        if ( $total_max > 0 && $total > $total_max ) {
                            wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                            return false;
                        }
                    }
                } else {
                    wc_add_notice( esc_html__( 'You cannot add this bundle to the cart.', 'woo-product-bundle' ), 'error' );

                    return false;
                }
            }

            return $passed;
        }

        function add_cart_item_data( $cart_item_data, $product_id ) {
            if ( empty( $cart_item_data['woosb_ids'] ) && ( $_product = wc_get_product( $product_id ) ) && $_product->is_type( 'woosb' ) && ( $ids = $_product->get_ids_str() ) ) {
                // get woosb_ids in custom data array
                $custom_request = apply_filters( 'woosb_custom_request_data', 'data' );

                if ( ! empty( $custom_request ) && ! empty( $_REQUEST[ $custom_request ]['woosb_ids'] ) ) {
                    $ids = $this->helper->clean_ids( wp_unslash( $_REQUEST[ $custom_request ]['woosb_ids'] ) );
                    unset( $_REQUEST[ $custom_request ]['woosb_ids'] );
                }

                // make sure that is a bundle
                if ( isset( $_REQUEST['woosb_ids'] ) ) {
                    $ids = $this->helper->clean_ids( wp_unslash( $_REQUEST['woosb_ids'] ) );
                    unset( $_REQUEST['woosb_ids'] );
                }

                if ( ! empty( $ids ) ) {
                    $cart_item_data['woosb_ids'] = $ids;

                    // Deterministic group key: identical bundles (same product + same items) share the same key so they get merged in the cart
                    if ( empty( $cart_item_data['woosb_group_key'] ) ) {
                        $cart_item_data['woosb_group_key'] = $this->get_group_key( $product_id, $ids );
                    }

                    // Structured bundle context
                    if ( empty( $cart_item_data['woosb_bundle'] ) ) {
                        $cart_item_data['woosb_bundle'] = [
                                'version'   => '2.0',
                                'role'      => 'parent',
                                'bundle_id' => 'woosb_' . $cart_item_data['woosb_group_key'],
                        ];
                    }
                }
            }

            return $cart_item_data;
        }

        function get_group_key( $product_id, $ids ) {
            // return true to make every added bundle unique (never merged), false to merge identical bundles
            if ( apply_filters( 'woosb_unique_group_key', false, $product_id, $ids ) ) {
                $group_key = md5( uniqid( (string) $product_id, true ) );
            } else {
                $group_key = md5( 'woosb|' . $product_id . '|' . ( is_scalar( $ids ) ? (string) $ids : wp_json_encode( $ids ) ) );
            }

            return apply_filters( 'woosb_group_key', $group_key, $product_id, $ids );
        }

        function add_to_cart( $cart_item_key, $product_id, $quantity, $variation_id, $variation, $cart_item_data ) {
            $edit_link = $this->helper->get_setting( 'edit_link', 'no' ) === 'yes';
            $edit_key  = sanitize_key( wp_unslash( $_REQUEST['woosb_update'] ?? '' ) );

            if ( $edit_link && ! empty( $edit_key ) && ( $edit_item = WC()->cart->get_cart_item( $edit_key ) ) ) {
                unset( $_REQUEST['woosb_update'] );

                if ( $edit_key === $cart_item_key ) {
                    WC()->cart->set_quantity( $cart_item_key, $edit_item['quantity'] - $quantity );
                } else {
                    WC()->cart->remove_cart_item( $edit_key );
                }
            }

            if ( ! empty( $cart_item_data['woosb_ids'] ) && isset( WC()->cart->cart_contents[ $cart_item_key ] ) ) {
                unset( WC()->cart->cart_contents[ $cart_item_key ]['woosb_keys'] );
                WC()->cart->cart_contents[ $cart_item_key ]['data']->build_items( $cart_item_data['woosb_ids'] );
                $items = WC()->cart->cart_contents[ $cart_item_key ]['data']->get_items();

                self::add_to_cart_items( $items, $cart_item_key, $product_id, $quantity );
            }
        }

        function restore_cart_item( $cart_item_key ) {
            if ( isset( WC()->cart->cart_contents[ $cart_item_key ]['woosb_ids'] ) ) {
                unset( WC()->cart->cart_contents[ $cart_item_key ]['woosb_keys'] );
                WC()->cart->cart_contents[ $cart_item_key ]['data']->build_items( WC()->cart->cart_contents[ $cart_item_key ]['woosb_ids'] );
                $items      = WC()->cart->cart_contents[ $cart_item_key ]['data']->get_items();
                $product_id = WC()->cart->cart_contents[ $cart_item_key ]['product_id'];
                $quantity   = WC()->cart->cart_contents[ $cart_item_key ]['quantity'];

                self::add_to_cart_items( $items, $cart_item_key, $product_id, $quantity );
            }
        }

        function add_to_cart_items( $items, $cart_item_key, $product_id, $quantity ) {
            if ( apply_filters( 'woosb_exclude_bundled', false ) ) {
                return;
            }

            $items = $this->helper->minify_items( $items );

            $fixed_price           = WC()->cart->cart_contents[ $cart_item_key ]['data']->is_fixed_price();
            $discount_amount       = WC()->cart->cart_contents[ $cart_item_key ]['data']->get_discount_amount();
            $discount_percentage   = WC()->cart->cart_contents[ $cart_item_key ]['data']->get_discount_percentage();
            $exclude_unpurchasable = WC()->cart->cart_contents[ $cart_item_key ]['data']->exclude_unpurchasable();

            // Save the current key associated with woosb_parent_key
            $group_key            = WC()->cart->cart_contents[ $cart_item_key ]['woosb_group_key'] ?? ( WC()->cart->cart_contents[ $cart_item_key ]['woosb_group_key'] = $this->get_group_key( $product_id, WC()->cart->cart_contents[ $cart_item_key ]['woosb_ids'] ?? $cart_item_key ) );
            $bundle_id            = WC()->cart->cart_contents[ $cart_item_key ]['woosb_bundle']['bundle_id'] ?? ( 'woosb_' . $group_key );
            $base_discount_amount = (float) WC()->cart->cart_contents[ $cart_item_key ]['data']->get_meta( 'woosb_discount_amount' );

            WC()->cart->cart_contents[ $cart_item_key ]['woosb_key']                  = $cart_item_key;
            WC()->cart->cart_contents[ $cart_item_key ]['woosb_group_key']            = $group_key;
            WC()->cart->cart_contents[ $cart_item_key ]['woosb_fixed_price']          = $fixed_price;
            WC()->cart->cart_contents[ $cart_item_key ]['woosb_discount_amount']      = $discount_amount;
            WC()->cart->cart_contents[ $cart_item_key ]['woosb_base_discount_amount'] = $base_discount_amount;
            WC()->cart->cart_contents[ $cart_item_key ]['woosb_discount']             = $discount_percentage;
            WC()->cart->cart_contents[ $cart_item_key ]['woosb_bundle']               = [
                    'version'          => '2.0',
                    'role'             => 'parent',
                    'bundle_id'        => $bundle_id,
                    'product_id'       => $product_id,
                    'pricing_mode'     => $fixed_price ? 'fixed' : 'auto',
                    'discount_amount'  => $discount_amount,
                    'discount_percent' => $discount_percentage,
                    'items'            => $items,
            ];

            if ( is_array( $items ) && ( count( $items ) > 0 ) ) {
                do_action( 'woosb_before_add_to_cart_items', $items, $cart_item_key, $product_id, $quantity );

                foreach ( $items as $item ) {
                    $_id           = $item['id'];
                    $_qty          = $item['qty'];
                    $_variation    = $item['attrs'];
                    $_variation_id = 0;

                    $_product = wc_get_product( $item['id'] );

                    if ( ! $_product || ( $_qty <= 0 ) || in_array( $_product->get_type(), $this->helper::get_types(), true ) ) {
                        continue;
                    }

                    if ( ( ! $this->helper->is_purchasable( $_product, 'add_to_cart' ) || ! $_product->is_in_stock() ) && $exclude_unpurchasable ) {
                        // exclude unpurchasable
                        continue;
                    }

                    if ( $_product instanceof WC_Product_Variation ) {
                        // ensure we don't add a variation to the cart directly by variation ID
                        $_variation_id = $_id;
                        $_id           = $_product->get_parent_id();

                        if ( empty( $_variation ) ) {
                            $_variation = $_product->get_variation_attributes();
                        }
                    }

                    // add to cart
                    $_data = [
                            'woosb_qty'                  => $_qty,
                            'woosb_parent_id'            => $product_id,
                            'woosb_parent_key'           => $cart_item_key,
                            'woosb_group_key'            => $group_key,
                            'woosb_fixed_price'          => $fixed_price,
                            'woosb_discount_amount'      => $discount_amount,
                            'woosb_base_discount_amount' => $base_discount_amount,
                            'woosb_discount'             => $discount_percentage,
                            'woosb_bundle'               => [
                                    'version'          => '2.0',
                                    'role'             => 'child',
                                    'bundle_id'        => $bundle_id,
                                    'parent_id'        => $product_id,
                                    'qty_per_bundle'   => $_qty,
                                    'pricing_mode'     => $fixed_price ? 'fixed' : 'auto',
                                    'discount_amount'  => $discount_amount,
                                    'discount_percent' => $discount_percentage,
                            ],
                    ];

                    $_data = apply_filters( 'woosb_bundled_cart_item_data', $_data, $item, $cart_item_key );

                    do_action( 'woosb_before_add_to_cart_item', $item, $cart_item_key, $product_id, $quantity, $_data );

                    // WC_Cart::add_to_cart() checks is_purchasable() itself, so run it inside the bundled context
                    $this->helper->start_bundled_context();

                    try {
                        $_key = WC()->cart->add_to_cart( $_id, $_qty * $quantity, $_variation_id, $_variation, $_data );
                    } finally {
                        $this->helper->end_bundled_context();
                    }

                    do_action( 'woosb_after_add_to_cart_item', $_key, $item, $cart_item_key, $product_id, $quantity, $_data );

                    if ( empty( $_key ) ) {
                        if ( ! $exclude_unpurchasable ) {
                            // can't add the bundled product
                            foreach ( $this->helper->get_bundle_cart_keys( WC()->cart->cart_contents, $bundle_id, 'child' ) as $key ) {
                                // remove all bundled products
                                WC()->cart->remove_cart_item( $key );
                            }

                            // remove the bundle
                            WC()->cart->remove_cart_item( $cart_item_key );

                            // break out of the loop
                            break;
                        }
                    } elseif ( ! isset( WC()->cart->cart_contents[ $cart_item_key ]['woosb_keys'] ) || ! in_array( $_key, WC()->cart->cart_contents[ $cart_item_key ]['woosb_keys'], true ) ) {
                        // save the current key
                        WC()->cart->cart_contents[ $_key ]['woosb_key'] = $_key;

                        // add keys for parent
                        WC()->cart->cart_contents[ $cart_item_key ]['woosb_keys'][] = $_key;
                    }
                } // end foreach

                do_action( 'woosb_after_add_to_cart_items', $items, $cart_item_key, $product_id, $quantity );
            }
        }

        function get_cart_item_from_session( $cart_item, $session_values ) {
            if ( ! empty( $session_values['woosb_bundle'] ) ) {
                $cart_item['woosb_bundle'] = $session_values['woosb_bundle'];
            }

            if ( ! empty( $session_values['woosb_ids'] ) ) {
                $cart_item['woosb_ids'] = $session_values['woosb_ids'];
            }

            if ( ! empty( $session_values['woosb_group_key'] ) ) {
                $cart_item['woosb_group_key'] = $session_values['woosb_group_key'];
            }

            if ( ! empty( $session_values['woosb_keys'] ) ) {
                $cart_item['woosb_keys'] = $session_values['woosb_keys'];
            }

            if ( isset( $session_values['woosb_fixed_price'] ) ) {
                $cart_item['woosb_fixed_price'] = $session_values['woosb_fixed_price'];
            }

            if ( isset( $session_values['woosb_discount_amount'] ) ) {
                $cart_item['woosb_discount_amount'] = $session_values['woosb_discount_amount'];
            }

            if ( isset( $session_values['woosb_base_discount_amount'] ) ) {
                $cart_item['woosb_base_discount_amount'] = $session_values['woosb_base_discount_amount'];
            }

            if ( isset( $session_values['woosb_discount'] ) ) {
                $cart_item['woosb_discount'] = $session_values['woosb_discount'];
            }

            if ( isset( $session_values['woosb_price'] ) ) {
                $cart_item['woosb_price'] = $session_values['woosb_price'];
            }

            if ( ! empty( $session_values['woosb_parent_id'] ) ) {
                $cart_item['woosb_parent_id']  = $session_values['woosb_parent_id'];
                $cart_item['woosb_parent_key'] = $session_values['woosb_parent_key'];
                $cart_item['woosb_qty']        = $session_values['woosb_qty'];
            }

            return apply_filters( 'woosb_get_cart_item_from_session', $cart_item, $session_values );
        }

        function before_mini_cart_contents() {
            WC()->cart->calculate_totals();
        }

        function before_calculate_totals( $cart_object ) {
            if ( ! defined( 'DOING_AJAX' ) && is_admin() ) {
                // This is necessary for WC 3.0+
                return;
            }

            $cart_contents = $cart_object->cart_contents;
            $new_keys      = [];

            foreach ( $cart_contents as $cart_item_key => $cart_item ) {
                if ( ! empty( $cart_item['woosb_key'] ) ) {
                    $new_keys[ $cart_item_key ] = $cart_item['woosb_key'];
                }
            }

            // Group items into bundles and child products
            $bundles           = [];
            $children          = [];
            $parent_bundle_ids = [];

            foreach ( $cart_contents as $cart_item_key => $cart_item ) {
                $bundle_id = $this->helper->get_bundle_id( $cart_item );

                if ( $this->helper->is_bundle_parent( $cart_item ) ) {
                    // Bundle Parent
                    if ( empty( $bundle_id ) ) {
                        // legacy parent without bundle_id
                        $bundle_id = 'woosb_' . $cart_item_key;
                    }

                    $bundles[ $bundle_id ]                = [
                            'key'  => $cart_item_key,
                            'item' => $cart_item,
                    ];
                    $parent_bundle_ids[ $cart_item_key ] = $bundle_id;
                } elseif ( $this->helper->is_bundle_child( $cart_item ) ) {
                    // Bundle Child
                    $children[ $cart_item_key ] = [
                            'key'       => $cart_item_key,
                            'bundle_id' => $bundle_id,
                            'item'      => $cart_item,
                    ];
                }
            }

            // Process child items and validate against parent
            $bundle_children_map = [];

            foreach ( $children as $child_key => $child_data ) {
                $child_item = $child_data['item'];
                $bundle_id  = $child_data['bundle_id'];
                $parent_key = null;

                // Match with parent by bundle_id first
                if ( $bundle_id && isset( $bundles[ $bundle_id ] ) ) {
                    $parent_key = $bundles[ $bundle_id ]['key'];
                }

                // Fallback to legacy parent key matching
                if ( ! $parent_key && ! empty( $child_item['woosb_parent_key'] ) ) {
                    $parent_key = array_search( $child_item['woosb_parent_key'], $new_keys ) ?: ( isset( $cart_contents[ $child_item['woosb_parent_key'] ] ) ? $child_item['woosb_parent_key'] : null );
                }

                // Remove orphaned child items
                if ( apply_filters( 'woosb_remove_orphaned_bundled_products', true ) ) {
                    if ( ! $parent_key || ! isset( $cart_contents[ $parent_key ] ) ) {
                        unset( $cart_contents[ $child_key ] );
                        if ( isset( WC()->cart->cart_contents[ $child_key ] ) ) {
                            WC()->cart->remove_cart_item( $child_key );
                        }
                        continue;
                    }
                }

                if ( ! $parent_key || ! isset( $cart_contents[ $parent_key ] ) ) {
                    continue;
                }

                // Synchronize child quantity with parent quantity
                if ( ! empty( $child_item['woosb_qty'] ) && isset( $cart_contents[ $parent_key ]['quantity'] ) ) {
                    $target_qty                                         = $child_item['woosb_qty'] * $cart_contents[ $parent_key ]['quantity'];
                    $cart_contents[ $child_key ]['quantity']            = $target_qty;
                    WC()->cart->cart_contents[ $child_key ]['quantity'] = $target_qty;
                }

                // Map child under parent
                $parent_bundle_id                           = $parent_bundle_ids[ $parent_key ] ?? ( 'woosb_' . $parent_key );
                $bundle_children_map[ $parent_bundle_id ][] = $child_key;
            }

            // Now calculate pricing for each bundle and its children
            foreach ( $bundles as $bundle_id => $bundle_info ) {
                $parent_key  = $bundle_info['key'];
                $parent_item = $cart_contents[ $parent_key ] ?? null;

                if ( ! $parent_item ) {
                    continue;
                }

                // Skip items without a complete pricing context (e.g. items cloned by third-party plugins with partial bundle data)
                $has_pricing_context = array_key_exists( 'woosb_fixed_price', $parent_item ) || isset( $parent_item['woosb_bundle']['pricing_mode'] );

                if ( ! apply_filters( 'woosb_has_pricing_context', $has_pricing_context, $parent_item, $parent_key ) ) {
                    continue;
                }

                $is_fixed_price = ! empty( $parent_item['woosb_fixed_price'] ) || ( isset( $parent_item['woosb_bundle']['pricing_mode'] ) && $parent_item['woosb_bundle']['pricing_mode'] === 'fixed' );
                $child_keys     = $bundle_children_map[ $bundle_id ] ?? [];

                if ( $is_fixed_price ) {
                    // Fixed Price: child items are free (price 0), parent maintains bundle price
                    foreach ( $child_keys as $child_key ) {
                        if ( isset( $cart_contents[ $child_key ]['data'] ) ) {
                            $cart_contents[ $child_key ]['data']->set_price( 0 );
                            $cart_contents[ $child_key ]['data']->get_price();
                        }
                    }
                } else {
                    // Auto Price: Rebuild items to sync quantity if woosb_ids is present
                    if ( ! empty( $parent_item['woosb_ids'] ) ) {
                        $parent_item['data']->build_items( $parent_item['woosb_ids'] );
                    }

                    // Bundle parent price (default 0 for auto pricing, can be modified for extra product addons)
                    $parent_price = (float) apply_filters( 'woosb_parent_item_price_before_set', 0, $parent_item, $cart_object );

                    // Set tax status 'none' for bundle parent if required
                    if ( apply_filters( 'woosb_ignore_tax_for_bundles', $parent_price > 0 ? false : true, $parent_item, $parent_price ) ) {
                        $parent_item['data']->set_tax_status( 'none' );
                    }

                    // Bundle parent price is set to 0 (or custom price from addons)
                    $parent_item['data']->set_price( $parent_price );
                    $parent_item['data']->get_price();

                    // 1. Calculate base unit price and display price for each child
                    $child_unit_prices         = [];
                    $child_display_line_totals = [];
                    $child_tax_factors         = [];
                    $display_incl_tax          = ! is_null( WC()->cart ) ? WC()->cart->display_prices_including_tax() : ( get_option( 'woocommerce_tax_display_cart' ) === 'incl' );

                    foreach ( $child_keys as $child_key ) {
                        $child_item = $cart_contents[ $child_key ];
                        $_product   = wc_get_product( $child_item['variation_id'] ?: $child_item['product_id'] );
                        $_price     = (float) $this->helper->get_price( $_product );

                        // Apply percentage discount
                        $child_discount = isset( $child_item['woosb_discount'] ) ? (float) $child_item['woosb_discount'] : (float) ( $parent_item['woosb_discount'] ?? 0 );
                        if ( ! empty( $child_discount ) ) {
                            $_price *= ( 100 - $child_discount ) / 100;
                        }

                        $_price = $this->helper->round_price( $_price );
                        $_price = apply_filters( 'woosb_item_price_add_to_cart', $_price, $child_item );
                        $_price = apply_filters( 'woosb_item_price_before_set', $_price, $child_item );

                        // Calculate unit display price to align with frontend displayed bundle pricing
                        if ( $display_incl_tax ) {
                            $_display_price = wc_get_price_including_tax( $_product, [
                                    'price' => $_price,
                                    'qty'   => 1,
                            ] );
                        } else {
                            $_display_price = wc_get_price_excluding_tax( $_product, [
                                    'price' => $_price,
                                    'qty'   => 1,
                            ] );
                        }

                        $tax_factor = ( $_price > 0 && $_display_price > 0 ) ? ( $_display_price / $_price ) : 1.0;

                        $child_qty_in_bundle                     = ! empty( $child_item['woosb_qty'] ) ? (float) $child_item['woosb_qty'] : 1;
                        $child_unit_prices[ $child_key ]         = $_price;
                        $child_tax_factors[ $child_key ]         = $tax_factor;
                        $child_display_line_totals[ $child_key ] = $_display_price * $child_qty_in_bundle;
                    }

                    // 2. Proportionally allocate fixed discount amount across children on display price using Largest Remainder Method
                    $discount_amount = apply_filters( 'woosb_cart_item_discount_amount', (float) ( $parent_item['woosb_discount_amount'] ?? 0 ), $parent_item );
                    $allocations     = [];

                    if ( $discount_amount > 0 && ! empty( $child_display_line_totals ) ) {
                        $precision   = function_exists( 'wc_get_price_decimals' ) ? wc_get_price_decimals() : 2;
                        $allocations = WPCleverWoosb_Helper::allocate_discount_proportionally( $discount_amount, $child_display_line_totals, $precision );
                    }

                    // 3. Set final price on each child item (converted to raw unit price for set_price)
                    foreach ( $child_keys as $child_key ) {
                        $child_item          = $cart_contents[ $child_key ];
                        $child_qty_in_bundle = ! empty( $child_item['woosb_qty'] ) ? (float) $child_item['woosb_qty'] : 1;
                        $line_discount       = $allocations[ $child_key ] ?? 0.0;
                        $orig_display_line   = $child_display_line_totals[ $child_key ] ?? 0.0;
                        $final_display_line  = max( 0.0, $orig_display_line - $line_discount );
                        $final_display_unit  = $child_qty_in_bundle > 0 ? ( $final_display_line / $child_qty_in_bundle ) : 0.0;

                        $tax_factor     = $child_tax_factors[ $child_key ] ?? 1.0;
                        $final_raw_unit = $tax_factor > 0 ? ( $final_display_unit / $tax_factor ) : $final_display_unit;

                        $cart_contents[ $child_key ]['data']->set_price( $final_raw_unit );
                        $cart_contents[ $child_key ]['data']->get_price();
                    }

                    // 4. Calculate display price for parent bundle
                    $bundles_display_price = 0;

                    foreach ( $child_keys as $child_key ) {
                        if ( isset( $cart_contents[ $child_key ], $cart_contents[ $child_key ]['data'] ) ) {
                            $child_item          = $cart_contents[ $child_key ];
                            $child_qty_in_bundle = ! empty( $child_item['woosb_qty'] ) ? (float) $child_item['woosb_qty'] : 1;

                            if ( ! is_null( WC()->cart ) && WC()->cart->display_prices_including_tax() ) {
                                $_child_display = wc_get_price_including_tax( $child_item['data'], [
                                        'price' => $child_item['data']->get_price(),
                                        'qty'   => $child_qty_in_bundle,
                                ] );
                            } else {
                                $_child_display = wc_get_price_excluding_tax( $child_item['data'], [
                                        'price' => $child_item['data']->get_price(),
                                        'qty'   => $child_qty_in_bundle,
                                ] );
                            }

                            $bundles_display_price += $this->helper->round_price( $_child_display );
                        }
                    }

                    if ( $parent_price > 0 ) {
                        if ( ! is_null( WC()->cart ) && WC()->cart->display_prices_including_tax() ) {
                            $_parent_display = wc_get_price_including_tax( $parent_item['data'], [
                                    'price' => $parent_price,
                                    'qty'   => 1,
                            ] );
                        } else {
                            $_parent_display = wc_get_price_excluding_tax( $parent_item['data'], [
                                    'price' => $parent_price,
                                    'qty'   => 1,
                            ] );
                        }

                        $bundles_display_price += $this->helper->round_price( $_parent_display );
                    }

                    $bundles_display_price = apply_filters( 'woosb_bundles_display_price', $bundles_display_price, $parent_item );

                    if ( $parent_item['quantity'] > 0 ) {
                        // Store bundles total for display
                        WC()->cart->cart_contents[ $parent_key ]['woosb_price'] = $this->helper->round_price( $bundles_display_price );
                    }
                }
            }
        }

        function cart_item_price( $price, $cart_item ) {
            if ( isset( $cart_item['woosb_ids'], $cart_item['woosb_price'], $cart_item['woosb_fixed_price'] ) && ! $cart_item['woosb_fixed_price'] ) {
                return apply_filters( 'woosb_cart_item_price', wc_price( $cart_item['woosb_price'] ), $price, $cart_item );
            }

            if ( isset( $cart_item['woosb_parent_id'], $cart_item['woosb_fixed_price'] ) && $cart_item['woosb_fixed_price'] ) {
                $_product = wc_get_product( $cart_item['variation_id'] ?: $cart_item['product_id'] );

                if ( ! is_null( WC()->cart ) && WC()->cart->display_prices_including_tax() ) {
                    $_price = wc_price( wc_get_price_including_tax( $_product ) );
                } else {
                    $_price = wc_price( wc_get_price_excluding_tax( $_product ) );
                }

                return apply_filters( 'woosb_cart_item_price', $_price, $price, $cart_item );
            }

            return $price;
        }

        function cart_item_subtotal( $subtotal, $cart_item = null ) {
            if ( isset( $cart_item['woosb_ids'], $cart_item['woosb_price'], $cart_item['woosb_fixed_price'] ) && ! $cart_item['woosb_fixed_price'] ) {
                $_subtotal = wc_price( $cart_item['woosb_price'] * $cart_item['quantity'] );

                if ( wc_tax_enabled() && ! is_null( WC()->cart ) && WC()->cart->display_prices_including_tax() && ! wc_prices_include_tax() ) {
                    $_subtotal .= ' <small class="tax_label">' . WC()->countries->inc_tax_or_vat() . '</small>';
                }

                return apply_filters( 'woosb_cart_item_subtotal', $_subtotal, $subtotal, $cart_item );
            }

            if ( isset( $cart_item['woosb_parent_id'], $cart_item['woosb_fixed_price'] ) && $cart_item['woosb_fixed_price'] ) {
                $_product = wc_get_product( $cart_item['variation_id'] ?: $cart_item['product_id'] );

                if ( ! is_null( WC()->cart ) && WC()->cart->display_prices_including_tax() ) {
                    $_subtotal = wc_price( wc_get_price_including_tax( $_product, [ 'qty' => $cart_item['quantity'] ] ) );
                } else {
                    $_subtotal = wc_price( wc_get_price_excluding_tax( $_product, [ 'qty' => $cart_item['quantity'] ] ) );
                }

                if ( wc_tax_enabled() && ! is_null( WC()->cart ) && WC()->cart->display_prices_including_tax() && ! wc_prices_include_tax() ) {
                    $_subtotal .= ' <small class="tax_label">' . WC()->countries->inc_tax_or_vat() . '</small>';
                }

                return apply_filters( 'woosb_cart_item_subtotal', $_subtotal, $subtotal, $cart_item );
            }

            return $subtotal;
        }

        function mini_cart_item_visible( $visible, $cart_item ) {
            if ( isset( $cart_item['woosb_parent_id'] ) ) {
                if ( ! apply_filters( 'woosb_item_visible', true, $cart_item['data'], $cart_item['woosb_parent_id'] ) ) {
                    return false;
                }

                if ( $this->helper->get_setting( 'hide_bundled_mini_cart', 'no' ) === 'yes' ) {
                    return false;
                }
            }

            return $visible;
        }

        function cart_item_visible( $visible, $cart_item ) {
            if ( isset( $cart_item['woosb_parent_id'] ) ) {
                if ( ! apply_filters( 'woosb_item_visible', true, $cart_item['data'], $cart_item['woosb_parent_id'] ) ) {
                    return false;
                }

                if ( $this->helper->get_setting( 'hide_bundled', 'no' ) !== 'no' ) {
                    return false;
                }
            }

            return $visible;
        }

        function order_item_visible( $visible, $order_item ) {
            if ( ! is_a( $order_item, 'WC_Order_Item' ) ) {
                return $visible;
            }

            if ( $parent_id = $order_item->get_meta( '_woosb_parent_id' ) ) {
                if ( ! apply_filters( 'woosb_item_visible', true, $order_item->get_product(), $parent_id ) ) {
                    return false;
                }

                if ( $this->helper->get_setting( 'hide_bundled_order', 'no' ) !== 'no' ) {
                    return false;
                }
            }

            return $visible;
        }

        function cart_item_class( $class, $cart_item ) {
            if ( isset( $cart_item['woosb_parent_id'] ) ) {
                $class .= ' woosb-cart-item woosb-cart-child woosb-item-child';
            } elseif ( isset( $cart_item['woosb_ids'] ) ) {
                $class .= ' woosb-cart-item woosb-cart-parent woosb-item-parent';
            }

            return $class;
        }

        function cart_item_meta( $data, $cart_item ) {
            if ( empty( $cart_item['woosb_ids'] ) ) {
                return $data;
            }

            $cart_item['data']->build_items( $cart_item['woosb_ids'] );
            $items     = $cart_item['data']->get_items();
            $parent_id = $cart_item['product_id'];

            if ( $this->helper->get_setting( 'hide_bundled', 'no' ) === 'yes_list' ) {
                $items_str = [];

                if ( is_array( $items ) && ! empty( $items ) ) {
                    foreach ( $items as $item ) {
                        if ( ! apply_filters( 'woosb_item_visible', true, $item['id'], $parent_id ) ) {
                            continue;
                        }

                        $items_str[] = apply_filters( 'woosb_order_bundled_product_name', '<li>' . esc_html( $item['qty'] ) . ' × ' . esc_html( get_the_title( $item['id'] ) ) . '</li>', $item );
                    }
                }

                $data['woosb_data'] = [
                        'key'     => $this->helper->localization( 'bundled_products', esc_html__( 'Bundled products', 'woo-product-bundle' ) ),
                        'value'   => esc_html( $cart_item['woosb_ids'] ),
                        'display' => apply_filters( 'woosb_order_bundled_product_names', '<ul>' . implode( '', $items_str ) . '</ul>', $items ),
                ];
            } else {
                $items_str = [];

                if ( is_array( $items ) && ! empty( $items ) ) {
                    foreach ( $items as $item ) {
                        if ( ! apply_filters( 'woosb_item_visible', true, $item['id'], $parent_id ) ) {
                            continue;
                        }

                        $items_str[] = apply_filters( 'woosb_order_bundled_product_name', esc_html( $item['qty'] ) . ' × ' . esc_html( get_the_title( $item['id'] ) ), $item );
                    }
                }

                $data['woosb_data'] = [
                        'key'     => $this->helper->localization( 'bundled_products', esc_html__( 'Bundled products', 'woo-product-bundle' ) ),
                        'value'   => esc_html( $cart_item['woosb_ids'] ),
                        'display' => apply_filters( 'woosb_order_bundled_product_names', implode( '; ', $items_str ), $items ),
                ];
            }

            return $data;
        }

        function create_order_line_item( $order_item, $cart_item_key, $values ) {
            if ( isset( $values['woosb_parent_id'] ) ) {
                // use _ to hide the data
                $order_item->update_meta_data( '_woosb_parent_id', $values['woosb_parent_id'] );
            }

            if ( isset( $values['woosb_bundle'] ) ) {
                $order_item->update_meta_data( '_woosb_bundle', $values['woosb_bundle'] );
            }

            if ( isset( $values['woosb_ids'] ) ) {
                // use _ to hide the data
                $order_item->update_meta_data( '_woosb_ids', $this->helper->clean_ids( $values['woosb_ids'] ) );
            }

            if ( isset( $values['woosb_price'] ) ) {
                // use _ to hide the data
                $order_item->update_meta_data( '_woosb_price', $values['woosb_price'] );
            }
        }

        function order_item_meta_start( $order_item_id, $order_item ) {
            if ( $ids = $order_item->get_meta( '_woosb_ids' ) ) {
                $parent    = $order_item->get_product();
                $parent_id = $parent->get_id();
                $items     = self::get_bundled( $ids, $parent );

                if ( $this->helper->get_setting( 'hide_bundled_order', 'no' ) === 'yes_list' ) {
                    $items_str = [];

                    if ( is_array( $items ) && ! empty( $items ) ) {
                        foreach ( $items as $item ) {
                            if ( ! empty( $item['id'] ) ) {
                                if ( ! apply_filters( 'woosb_item_visible', true, $item['id'], $parent_id ) ) {
                                    continue;
                                }

                                $items_str[] = apply_filters( 'woosb_order_bundled_product_name', '<li>' . esc_html( $item['qty'] ) . ' × ' . esc_html( get_the_title( $item['id'] ) ) . '</li>', $item );
                            }
                        }
                    }

                    $items_str = apply_filters( 'woosb_order_bundled_product_names', '<ul>' . implode( '', $items_str ) . '</ul>', $items );
                } else {
                    $items_str = [];

                    if ( is_array( $items ) && ! empty( $items ) ) {
                        foreach ( $items as $item ) {
                            if ( ! empty( $item['id'] ) ) {
                                if ( ! apply_filters( 'woosb_item_visible', true, $item['id'], $parent_id ) ) {
                                    continue;
                                }

                                $items_str[] = apply_filters( 'woosb_order_bundled_product_name', esc_html( $item['qty'] ) . ' × ' . esc_html( get_the_title( $item['id'] ) ), $item );
                            }
                        }
                    }

                    $items_str = apply_filters( 'woosb_order_bundled_product_names', implode( '; ', $items_str ), $items );
                }

                echo apply_filters( 'woosb_before_order_itemmeta_bundles', '<div class="woosb-itemmeta-bundles">' . /* translators: %s is the product list */ sprintf( $this->helper->localization( 'bundled_products_s', esc_html__( 'Bundled products: %s', 'woo-product-bundle' ) ), $items_str ) . '</div>', $order_item_id, $order_item );
            }
        }

        function formatted_line_subtotal( $subtotal, $order_item ) {
            if ( isset( $order_item['_woosb_ids'], $order_item['_woosb_price'] ) ) {
                return apply_filters( 'woosb_order_item_subtotal', wc_price( $order_item['_woosb_price'] * $order_item['quantity'] ), $subtotal, $order_item );
            }

            return $subtotal;
        }

        function cart_item_remove_link( $link, $cart_item_key ) {
            $item = WC()->cart->cart_contents[ $cart_item_key ] ?? null;

            if ( $this->helper->is_bundle_child( $item ) ) {
                $bundle_id = $this->helper->get_bundle_id( $item );

                if ( ! empty( $bundle_id ) ) {
                    // hide the remove link while the parent of this bundle still exists
                    if ( $this->helper->get_bundle_parent_key( WC()->cart->cart_contents, $bundle_id ) ) {
                        return '';
                    }

                    return $link;
                }

                // legacy items without bundle_id: match by cart item keys
                if ( isset( $item['woosb_parent_key'] ) ) {
                    $parent_key = $item['woosb_parent_key'];

                    if ( isset( WC()->cart->cart_contents[ $parent_key ] ) || array_search( $parent_key, array_column( WC()->cart->cart_contents, 'woosb_key', 'key' ) ) ) {
                        return '';
                    }
                }
            }

            return $link;
        }

        function cart_item_quantity( $quantity, $cart_item_key, $cart_item ) {
            // add qty as text - not input
            if ( isset( $cart_item['woosb_parent_id'] ) ) {
                return $cart_item['quantity'];
            }

            return $quantity;
        }

        function product_summary_bundles() {
            self::show_bundles();
        }

        function product_summary_bundled() {
            self::show_bundled();
        }

        function product_tabs( $tabs ) {
            global $product;
            $product_id = $product->get_id();

            if ( ( $this->helper->get_setting( 'bundled_position', 'above' ) === 'tab' ) && $product->is_type( 'woosb' ) ) {
                $tabs['woosb_bundled'] = apply_filters( 'woosb_bundled_tab', [
                        'title'    => $this->helper->localization( 'bundled_products', esc_html__( 'Bundled products', 'woo-product-bundle' ) ),
                        'priority' => 50,
                        'callback' => [ $this, 'product_tab_bundled' ]
                ], $product );
            }

            if ( ( $this->helper->get_setting( 'bundles_position', 'no' ) === 'tab' ) && ! $product->is_type( 'woosb' ) && self::get_bundles( $product_id ) ) {
                $tabs['woosb_bundles'] = apply_filters( 'woosb_bundles_tab', [
                        'title'    => $this->helper->localization( 'bundles', esc_html__( 'Bundles', 'woo-product-bundle' ) ),
                        'priority' => 50,
                        'callback' => [ $this, 'product_tab_bundles' ]
                ], $product );
            }

            return $tabs;
        }

        function product_tab_bundled() {
            self::show_bundled();
        }

        function product_tab_bundles() {
            self::show_bundles();
        }

        function product_price_class( $class ) {
            global $product;

            if ( $product && is_a( $product, 'WC_Product_Woosb' ) ) {
                $class .= ' woosb-price-' . $product->get_id();
            }

            return $class;
        }

        function add_to_cart_form() {
            global $product;

            if ( ! $product || ! is_a( $product, 'WC_Product_Woosb' ) ) {
                return;
            }

            if ( $product->has_variables() ) {
                wp_enqueue_script( 'wc-add-to-cart-variation' );
            }

            do_action( 'woosb_before_add_to_cart_form', $product );

            if ( ( $this->helper->get_setting( 'bundled_position', 'above' ) === 'above' ) && apply_filters( 'woosb_show_bundled', true, $product->get_id() ) ) {
                self::show_bundled();
            }

            $edit_link = $this->helper->get_setting( 'edit_link', 'no' ) === 'yes';
            $edit_ids  = isset( $_GET['edit'] ) ? explode( ',', base64_decode( sanitize_text_field( wp_unslash( $_GET['edit'] ) ) ) ) : [];
            $edit_key  = sanitize_key( wp_unslash( $_GET['key'] ?? '' ) );

            if ( $edit_link && ! empty( $edit_ids ) && ! empty( $edit_key ) && ( $product->has_optional() || $product->has_variables() ) && ( $edit_item = WC()->cart->get_cart_item( $edit_key ) ) ) {
                // edit cart item
                global $product;

                if ( is_a( $product, 'WC_Product_Woosb' ) ) {
                    $product_id = $product->get_id();
                    $quantity   = $edit_item['quantity'] ?: 1;
                    echo '<form class="cart" action="' . esc_url( wc_get_cart_url() ) . '" method="post" enctype="multipart/form-data">';
                    echo '<input type="hidden" name="woosb_ids" class="woosb-ids woosb-ids-' . esc_attr( $product_id ) . '" value=""/>';
                    echo '<input type="hidden" name="woosb_update" value="' . esc_attr( $edit_key ) . '"/>';
                    echo '<input type="hidden" name="quantity" value="' . esc_attr( $quantity ) . '"/>';
                    echo '<button type="submit" name="add-to-cart" value="' . esc_attr( $product_id ) . '" class="single_add_to_cart_button button alt">' . esc_html( $this->helper->localization( 'cart_item_update', esc_html__( 'Update', 'woo-product-bundle' ) ) ) . '</button>';
                    echo '</form>';
                }
            } else {
                wc_get_template( 'single-product/add-to-cart/simple.php' );
            }

            if ( ( $this->helper->get_setting( 'bundled_position', 'above' ) === 'below' ) && apply_filters( 'woosb_show_bundled', true, $product->get_id() ) ) {
                self::show_bundled();
            }

            do_action( 'woosb_after_add_to_cart_form', $product );
        }

        function add_to_cart_button() {
            global $product;

            if ( $product && is_a( $product, 'WC_Product_Woosb' ) && ( $ids = $product->get_ids_str() ) ) {
                echo '<input name="woosb_ids" class="woosb-ids woosb-ids-' . esc_attr( $product->get_id() ) . '" type="hidden" value="' . esc_attr( $ids ) . '"/>';
            }
        }

        function loop_add_to_cart_link( $link, $product ) {
            if ( $product->is_type( 'woosb' ) && ( $product->has_variables() || $product->has_optional() ) ) {
                $link = str_replace( 'ajax_add_to_cart', '', $link );
            }

            return $link;
        }

        function cart_shipping_packages( $packages ) {
            if ( ! empty( $packages ) ) {
                foreach ( $packages as $package_key => $package ) {
                    if ( ! empty( $package['contents'] ) ) {
                        foreach ( $package['contents'] as $cart_item_key => $cart_item ) {
                            if ( ! empty( $cart_item['woosb_parent_id'] ) ) {
                                $_parent = wc_get_product( $cart_item['woosb_parent_id'] );
                                if ( $_parent && ( $_parent->get_meta( 'woosb_shipping_fee' ) === 'whole' ) ) {
                                    unset( $packages[ $package_key ]['contents'][ $cart_item_key ] );
                                }
                            }

                            if ( ! empty( $cart_item['woosb_ids'] ) && ( $cart_item['data']->get_meta( 'woosb_shipping_fee' ) === 'each' ) ) {
                                unset( $packages[ $package_key ]['contents'][ $cart_item_key ] );
                            }
                        }
                    }
                }
            }

            return $packages;
        }

        function cart_contents_weight( $weight ) {
            if ( apply_filters( 'woosb_ignore_calc_weight', false ) ) {
                return $weight;
            }

            $weight = 0;

            foreach ( WC()->cart->get_cart() as $cart_item ) {
                if ( isset( $cart_item['data'] ) && is_a( $cart_item['data'], 'WC_Product' ) && $cart_item['data']->has_weight() ) {
                    $woosb_parent_id = ! empty( $cart_item['woosb_parent_id'] ) ? $cart_item['woosb_parent_id'] : 0;
                    $_parent         = $woosb_parent_id ? wc_get_product( $woosb_parent_id ) : null;

                    if ( ( $_parent && ( $_parent->get_meta( 'woosb_shipping_fee' ) === 'whole' ) ) || ( ! empty( $cart_item['woosb_ids'] ) && ( $cart_item['data']->get_meta( 'woosb_shipping_fee' ) === 'each' ) ) ) {
                        $weight += 0;
                    } else {
                        $weight += (float) $cart_item['data']->get_weight() * $cart_item['quantity'];
                    }
                }
            }

            return $weight;
        }

        function get_price_html( $price_html, $product ) {
            if ( is_admin() ) {
                return $price_html;
            }

            if ( $product->is_type( 'woosb' ) && ( $items = $product->get_items() ) ) {
                $exclude_unpurchasable = $product->exclude_unpurchasable();
                $custom_price          = $product->get_meta( 'woosb_custom_price' );
                $price_format          = $this->helper->get_setting( 'price_format', 'from_min' );
                $default_custom_price  = $this->helper->get_setting( 'price_format_custom', /* translators: dynamic price */ esc_html__( 'before %s after', 'woo-product-bundle' ) );

                if ( ! $product->is_fixed_price() && ! apply_filters( 'woosb_ignore_get_price_html', false ) ) {
                    $discount_amount     = $product->get_discount_amount();
                    $discount_percentage = $product->get_discount_percentage();

                    if ( $product->has_optional() ) {
                        if ( $price_format === 'min_only' || $price_format === 'from_min' ) {
                            $items_optional = []; // collect optional items only

                            foreach ( $items as $k => $item ) {
                                if ( $_product = wc_get_product( $item['id'] ) ) {
                                    // exclude heading/paragraph
                                    $_unpurchasable = ! $this->helper->is_purchasable( $_product, 'price' ) || ! $_product->is_in_stock() || ! $_product->has_enough_stock( $item['qty'] );

                                    if ( $exclude_unpurchasable && ! $_unpurchasable ) {
                                        $items[ $k ]['price'] = 0;
                                    } else {
                                        $items[ $k ]['price'] = $this->helper->get_price_to_display( $_product );
                                    }

                                    if ( ! empty( $item['optional'] ) && ! $_unpurchasable ) {
                                        $items_optional[ $k ] = $items[ $k ];
                                    }
                                }
                            }

                            // min price
                            $total_min = $total_qty = 0;

                            foreach ( $items as $item ) {
                                if ( isset( $item['price'] ) ) {
                                    // exclude heading/paragraph
                                    if ( ! empty( $item['optional'] ) && apply_filters( 'woosb_get_price_from_min_qty', true ) ) {
                                        $item_min  = ! empty( $item['min'] ) ? (float) $item['min'] : 0;
                                        $total_min += (float) $item['price'] * $item_min;
                                        $total_qty += $item_min;
                                    } else {
                                        $total_min += (float) $item['price'] * (float) $item['qty'];
                                        $total_qty += (float) $item['qty'];
                                    }

                                    if ( ! $discount_amount && $discount_percentage ) {
                                        $total_min *= ( 100 - (float) $discount_percentage ) / 100;
                                        $total_min = $this->helper->round_price( $total_min );
                                    }
                                }
                            }

                            // min whole
                            $min_whole = (float) ( $product->get_meta( 'woosb_limit_whole_min' ) ?: 1 );
                            $min_price = (float) ( ! empty( $items_optional ) ? min( array_column( $items_optional, 'price' ) ) : 0 );

                            if ( ! $discount_amount && $discount_percentage ) {
                                $min_price *= ( 100 - (float) $discount_percentage ) / 100;
                                $min_price = $this->helper->round_price( $min_price );
                            }

                            if ( $total_qty > 0 ) {
                                // has min each
                                if ( $min_whole > $total_qty ) {
                                    $total_min += ( $min_whole - $total_qty ) * $min_price;
                                }
                            } else {
                                $total_min += $min_whole * $min_price;
                            }

                            // discount
                            if ( $discount_amount ) {
                                $total_min -= (float) $discount_amount;
                            }

                            switch ( $price_format ) {
                                case 'min_only':
                                    $price_html = apply_filters( 'woosb_get_price_html_min_only', wc_price( $total_min ) . $product->get_price_suffix(), $total_min, $product );
                                    break;
                                case 'from_min':
                                    $price_html = apply_filters( 'woosb_get_price_html_from_min', '<span>' . esc_html( $this->helper->localization( 'from', esc_html__( 'From', 'woo-product-bundle' ) ) ) . '</span> ' . wc_price( $total_min ) . $product->get_price_suffix(), $total_min, $product );
                                    break;
                            }
                        }
                    } elseif ( $product->has_variables() ) {
                        if ( $price_format === 'min_only' || $price_format === 'min_max' || $price_format === 'from_min' ) {
                            $min_price = $max_price = 0;

                            foreach ( $items as $item ) {
                                if ( $_product = wc_get_product( $item['id'] ) ) {
                                    if ( $exclude_unpurchasable && ( ! $this->helper->is_purchasable( $_product, 'price' ) || ! $_product->is_in_stock() || ! $_product->has_enough_stock( $item['qty'] ) ) ) {
                                        continue;
                                    }

                                    $min_price += $this->helper->get_price_to_display( $_product, $item['qty'] );
                                    $max_price += $this->helper->get_price_to_display( $_product, $item['qty'], 'max' );
                                }
                            }

                            if ( $discount_amount ) {
                                $min_price -= (float) $discount_amount;
                                $max_price -= (float) $discount_amount;
                            } elseif ( $discount_percentage ) {
                                $min_price *= (float) ( 100 - $discount_percentage ) / 100;
                                $max_price *= (float) ( 100 - $discount_percentage ) / 100;
                            }

                            switch ( $price_format ) {
                                case 'min_only':
                                    $price_html = apply_filters( 'woosb_get_price_html_min_only', wc_price( $min_price ) . $product->get_price_suffix(), $min_price, $product );
                                    break;
                                case 'min_max':
                                    $price_html = apply_filters( 'woosb_get_price_html_min_max', wc_price( $min_price ) . ' - ' . wc_price( $max_price ) . $product->get_price_suffix(), $min_price, $max_price, $product );
                                    break;
                                case 'from_min':
                                    $price_html = apply_filters( 'woosb_get_price_html_from_min', '<span>' . esc_html( $this->helper->localization( 'from', esc_html__( 'From', 'woo-product-bundle' ) ) ) . '</span> ' . wc_price( $min_price ) . $product->get_price_suffix(), $min_price, $product );
                                    break;
                            }
                        }
                    } else {
                        // auto calculated price
                        $price_regular = $price_sale = $price = 0;

                        foreach ( $items as $item ) {
                            if ( $_product = wc_get_product( $item['id'] ) ) {
                                if ( $exclude_unpurchasable && ( ! $this->helper->is_purchasable( $_product, 'price' ) || ! $_product->is_in_stock() || ! $_product->has_enough_stock( $item['qty'] ) ) ) {
                                    continue;
                                }

                                $_price = $this->helper->get_price( $_product );

                                if ( $discount_percentage ) {
                                    // when haven't discount_amount, apply the discount percentage
                                    $_price *= ( 100 - (float) $discount_percentage ) / 100;
                                    $_price = $this->helper->round_price( $_price );
                                }

                                $_price        = apply_filters( 'woosb_item_price_add_to_cart', $_price, $_product );
                                $price         += $this->helper->get_price_to_display( $_product, [
                                        'price' => $_price,
                                        'qty'   => $item['qty']
                                ] );
                                $price_sale    += $this->helper->get_price_to_display( $_product, [ 'qty' => $item['qty'] ] );
                                $price_regular += wc_get_price_to_display( $_product, [
                                        'qty'   => $item['qty'],
                                        'price' => $_product->get_regular_price()
                                ] );
                            }
                        }

                        if ( $discount_amount ) {
                            $price = $price_sale - $discount_amount;
                        }

                        do_action( 'woosb_after_calculate_prices', $product, $price_regular, $price_sale, $price );

                        if ( $discount_amount || $discount_percentage ) {
                            $price_html = wc_format_sale_price( wc_price( $price_regular ), wc_price( $price ) ) . $product->get_price_suffix();
                        } else {
                            if ( $price < $price_regular ) {
                                $price_html = wc_format_sale_price( wc_price( $price_regular ), wc_price( $price ) ) . $product->get_price_suffix();
                            } else {
                                $price_html = wc_price( $price ) . $product->get_price_suffix();
                            }
                        }

                        $price_html = apply_filters( 'woosb_get_price_html_auto', $price_html, $price_regular, $price_sale, $price, $product );
                    }
                }

                if ( ! empty( $custom_price ) ) {
                    return str_replace( '%s', $price_html, $custom_price );
                }

                if ( ( $price_format === 'custom' ) && ! empty( $default_custom_price ) ) {
                    return str_replace( '%s', $price_html, $default_custom_price );
                }
            }

            return apply_filters( 'woosb_get_price_html', $price_html, $product );
        }

        function order_again_cart_item_data( $data, $item ) {
            if ( $ids = $item->get_meta( '_woosb_ids' ) ) {
                $data['woosb_order_again'] = 'yes';
                $data['woosb_ids']         = $ids;
            }

            if ( $parent_id = $item->get_meta( '_woosb_parent_id' ) ) {
                $data['woosb_order_again'] = 'yes';
                $data['woosb_parent_id']   = $parent_id;
            }

            return $data;
        }

        function cart_loaded_from_session( $cart ) {
            foreach ( $cart->cart_contents as $cart_item_key => $cart_item ) {
                // remove orphaned products
                if ( $this->helper->is_bundle_child( $cart_item ) ) {
                    $has_parent = false;
                    $bundle_id  = $this->helper->get_bundle_id( $cart_item );

                    if ( $bundle_id ) {
                        $has_parent = (bool) $this->helper->get_bundle_parent_key( $cart->cart_contents, $bundle_id );
                    } elseif ( isset( $cart_item['woosb_parent_key'] ) && isset( $cart->cart_contents[ $cart_item['woosb_parent_key'] ] ) ) {
                        // legacy items without bundle_id
                        $has_parent = true;
                    }

                    if ( ! $has_parent && apply_filters( 'woosb_remove_orphaned_bundled_product', true, $cart_item_key, $cart_item ) ) {
                        WC()->cart->remove_cart_item( $cart_item_key );
                    }
                }

                // if order again, remove bundled products first
                if ( isset( $cart_item['woosb_order_again'], $cart_item['woosb_parent_id'] ) ) {
                    WC()->cart->remove_cart_item( $cart_item_key );
                }
            }

            foreach ( $cart->cart_contents as $cart_item_key => $cart_item ) {
                // if order again, add bundled products again
                if ( isset( $cart_item['woosb_order_again'], $cart_item['woosb_ids'] ) ) {
                    unset( $cart->cart_contents[ $cart_item_key ]['woosb_order_again'] );
                    unset( $cart->cart_contents[ $cart_item_key ]['woosb_keys'] );
                    $cart_item['data']->build_items( $cart_item['woosb_ids'] );
                    $items     = $cart_item['data']->get_items();
                    $add_items = true;

                    foreach ( $items as $item ) {
                        $_product = wc_get_product( $item['id'] );

                        if ( ! $_product || in_array( $_product->get_type(), $this->helper::get_types(), true ) || ! $_product->is_in_stock() || ! $this->helper->is_purchasable( $_product, 'order_again' ) || empty( $item['qty'] ) || ! $_product->has_enough_stock( $item['qty'] * $cart_item['quantity'] ) ) {
                            $add_items = false;
                            break;
                        }
                    }

                    if ( $add_items ) {
                        self::add_to_cart_items( $items, $cart_item_key, $cart_item['product_id'], $cart_item['quantity'] );
                    } else {
                        unset( $cart->cart_contents[ $cart_item_key ] );
                    }
                }
            }
        }

        function coupon_is_valid_for_product( $valid, $product, $coupon, $cart_item ) {
            if ( ( $this->helper->get_setting( 'coupon_restrictions', 'no' ) === 'both' ) && ( isset( $cart_item['woosb_parent_id'] ) || isset( $cart_item['woosb_ids'] ) ) ) {
                // exclude both bundles and bundled products
                return false;
            }

            if ( ( $this->helper->get_setting( 'coupon_restrictions', 'no' ) === 'bundles' ) && isset( $cart_item['woosb_ids'] ) ) {
                // exclude bundles
                return false;
            }

            if ( ( $this->helper->get_setting( 'coupon_restrictions', 'no' ) === 'bundled' ) && isset( $cart_item['woosb_parent_id'] ) ) {
                // exclude bundled products
                return false;
            }

            /*
            if ( isset( $cart_item['woosb_parent_id'] ) && ( $parent = wc_get_product( $cart_item['woosb_parent_id'] ) ) ) {
                return $coupon->is_valid_for_product( $parent );
            }
            */

            return $valid;
        }

        function update_stock_status( $product_id, $stock_status, $product ) {
            if ( ! $product->is_type( 'woosb' ) ) {
                $bundles = self::get_bundles( $product_id, 500, 0, 'edit' );

                if ( ! empty( $bundles ) ) {
                    foreach ( $bundles as $bundle ) {
                        $bundle_id      = $bundle->get_id();
                        $visibility     = get_the_terms( $bundle_id, 'product_visibility' );
                        $visibility_arr = array_values( wp_list_pluck( $visibility, 'name' ) );

                        if ( $bundle->is_in_stock() ) {
                            $visibility_new = array_diff( $visibility_arr, [ 'outofstock' ] );
                        } else {
                            $visibility_new = array_merge( $visibility_arr, [ 'outofstock' ] );
                        }

                        wp_set_post_terms( $bundle_id, $visibility_new, 'product_visibility' );
                    }
                }
            }
        }

        /**
         * Triggered when a simple/variable product is saved.
         * Finds all bundles containing this product and recalculates their price.
         *
         * @param int $product_id Saved product ID.
         */
        function update_bundle_price_on_product_save( $product_id ) {
            $product = wc_get_product( $product_id );

            // Only process non-bundle products to avoid infinite loops
            if ( ! $product || $product->is_type( 'woosb' ) ) {
                return;
            }

            $this->update_bundle_prices_for_product( $product_id );
        }

        /**
         * Triggered when a product variation is saved.
         * Finds all bundles containing the parent variable product and recalculates their price.
         *
         * @param int $variation_id Saved variation ID.
         */
        function update_bundle_price_on_variation_save( $variation_id ) {
            $parent_id = wp_get_post_parent_id( $variation_id );

            if ( $parent_id ) {
                $this->update_bundle_prices_for_product( $parent_id );
            }

            // Also search bundles containing the variation directly
            $this->update_bundle_prices_for_product( $variation_id );
        }

        /**
         * Find all bundles containing the given product ID and update their stored prices.
         * Only updates bundles that use auto price (not fixed price).
         *
         * @param int $product_id The product ID to search for in bundles.
         */
        function update_bundle_prices_for_product( $product_id ) {
            if ( ! apply_filters( 'woosb_auto_update_bundle_price', true ) ) {
                return;
            }

            $bundles = self::get_bundles( $product_id, 500, 0, 'edit' );

            if ( empty( $bundles ) ) {
                return;
            }

            foreach ( $bundles as $bundle ) {
                // Skip bundles using fixed price
                if ( $bundle->is_fixed_price() ) {
                    continue;
                }

                $this->recalculate_bundle_price( $bundle );
            }
        }

        /**
         * Recalculate and persist the price of a bundle product based on its child items.
         *
         * @param WC_Product_Woosb $bundle The bundle product.
         */
        function recalculate_bundle_price( $bundle ) {
            $bundle_id = $bundle->get_id();
            $items     = $bundle->get_items();

            if ( empty( $items ) ) {
                return;
            }

            $regular_price = 0.0;

            foreach ( $items as $item ) {
                if ( empty( $item['id'] ) ) {
                    continue;
                }

                $_product = wc_get_product( $item['id'] );

                if ( ! $_product || $_product->is_type( 'woosb' ) ) {
                    continue;
                }

                if ( $_product->is_type( 'variable' ) ) {
                    $regular_price += (float) $_product->get_variation_regular_price( 'max' ) * (float) $item['qty'];
                } else {
                    $regular_price += (float) $_product->get_regular_price() * (float) $item['qty'];
                }
            }

            // Calculate sale price if discount is configured
            $discount_amount     = $bundle->get_discount_amount();
            $discount_percentage = $bundle->get_discount_percentage();
            $sale_price          = '';

            if ( $discount_amount || $discount_percentage ) {
                $sale_price_calc = 0.0;

                foreach ( $items as $item ) {
                    if ( empty( $item['id'] ) ) {
                        continue;
                    }

                    $_product = wc_get_product( $item['id'] );

                    if ( ! $_product || $_product->is_type( 'woosb' ) ) {
                        continue;
                    }

                    $_price = (float) $this->helper->get_price( $_product ) * (float) $item['qty'];

                    if ( $discount_percentage ) {
                        $sale_price_calc += $this->helper->round_price( $_price * ( 100 - $discount_percentage ) / 100 );
                    } else {
                        $sale_price_calc += $_price;
                    }
                }

                $sale_price = $discount_amount ? ( $sale_price_calc - $discount_amount ) : $sale_price_calc;
            }

            // Determine the active price (sale price takes priority if available)
            $price = $sale_price !== '' ? $sale_price : $regular_price;

            // Persist calculated prices to post_meta so WooCommerce search/filter works correctly
            update_post_meta( $bundle_id, '_regular_price', $regular_price );
            update_post_meta( $bundle_id, '_price', $price );

            if ( $sale_price !== '' ) {
                update_post_meta( $bundle_id, '_sale_price', $sale_price );
            } else {
                delete_post_meta( $bundle_id, '_sale_price' );
            }

            // Clear the WooCommerce product cache so the updated meta is reflected immediately
            wc_delete_product_transients( $bundle_id );

            do_action( 'woosb_after_update_bundle_price', $bundle_id, $regular_price, $sale_price, $price );
        }

        function show_bundled( $product = null ) {
            if ( ! $product ) {
                global $product;
            }

            if ( ! $product || ! is_a( $product, 'WC_Product_Woosb' ) ) {
                return;
            }

            $edit_ids = isset( $_GET['edit'] ) ? explode( ',', base64_decode( sanitize_text_field( wp_unslash( $_GET['edit'] ) ) ) ) : [];

            if ( $items = $product->get_items() ) {
                $order                 = 1;
                $product_id            = $product->get_id();
                $fixed_price           = $product->is_fixed_price();
                $has_variables         = $product->has_variables();
                $has_optional          = $product->has_optional();
                $discount_amount       = $product->get_discount_amount();
                $discount_percentage   = $product->get_discount_percentage();
                $exclude_unpurchasable = $product->exclude_unpurchasable();
                $total_limit           = $product->get_meta( 'woosb_total_limits' ) === 'on';
                $total_min             = $product->get_meta( 'woosb_total_limits_min' );
                $total_max             = $product->get_meta( 'woosb_total_limits_max' );
                $whole_min             = $product->get_meta( 'woosb_limit_whole_min' ) ?: 1;
                $whole_max             = $product->get_meta( 'woosb_limit_whole_max' ) ?: '-1';
                $layout                = $product->get_meta( 'woosb_layout' ) ?: 'unset';
                $layout                = $layout !== 'unset' ? $layout : $this->helper->get_setting( 'layout', 'list' );
                $bundled_price         = $this->helper->get_setting( 'bundled_price', 'price' );
                $products_class        = apply_filters( 'woosb_products_class', 'woosb-products woosb-products-layout-' . $layout, $product );
                $products_attrs        = apply_filters( 'woosb_products_attrs', [
                        'discount-amount'       => $discount_amount,
                        'discount'              => $discount_percentage,
                        'fixed-price'           => $fixed_price ? 'yes' : 'no',
                        'price'                 => wc_get_price_to_display( $product ),
                        'price-suffix'          => htmlentities( $product->get_price_suffix() ),
                        'variables'             => $has_variables ? 'yes' : 'no',
                        'optional'              => $has_optional ? 'yes' : 'no',
                        'min'                   => $whole_min,
                        'max'                   => $whole_max,
                        'total-min'             => $total_limit && $total_min ? $total_min : 0,
                        'total-max'             => $total_limit && $total_max ? $total_max : '-1',
                        'exclude-unpurchasable' => $exclude_unpurchasable ? 'yes' : 'no',
                ], $product );

                do_action( 'woosb_before_wrap', $product );

                echo '<div class="woosb-wrap woosb-bundled" data-id="' . esc_attr( $product_id ) . '">';

                if ( $before_text = apply_filters( 'woosb_before_text', $product->get_meta( 'woosb_before_text' ), $product_id ) ) {
                    echo '<div class="woosb-before-text woosb-text">' . wp_kses_post( do_shortcode( $before_text ) ) . '</div>';
                }

                do_action( 'woosb_before_table', $product );

                echo '<div class="' . esc_attr( $products_class ) . '" ' . $this->helper->data_attributes( $products_attrs ) . '>';
                // store global $product
                $global_product    = $product;
                $global_product_id = $product_id;

                foreach ( $items as $key => $item ) {
                    if ( ! empty( $item['id'] ) ) {
                        // exclude heading/paragraph
                        $product = wc_get_product( $item['id'] );

                        if ( ! $product || in_array( $product->get_type(), $this->helper::get_types(), true ) ) {
                            continue;
                        }

                        if ( apply_filters( 'woosb_item_exclude', false, $product, $global_product ) ) {
                            continue;
                        }

                        $item_qty = (float) ( $item['qty'] ?? 1 );
                        $item_min = ! empty( $item['min'] ) ? (float) $item['min'] : 0;
                        $item_max = ! empty( $item['max'] ) ? (float) $item['max'] : 10000;
                        $optional = ! empty( $item['optional'] );

                        if ( ! empty( $edit_ids ) ) {
                            foreach ( $edit_ids as $edit_id ) {
                                if ( str_contains( $edit_id, '/' . $key ) ) {
                                    $edit_id_arr = explode( '/', $edit_id );
                                    $item_qty    = (float) ( $edit_id_arr[2] ?? 1 );
                                }
                            }
                        }

                        if ( $optional ) {
                            if ( ( $max_purchase = $product->get_max_purchase_quantity() ) && ( $max_purchase > 0 ) && ( $max_purchase < $item_max ) ) {
                                // get_max_purchase_quantity can return -1
                                $item_max = $max_purchase;
                            }

                            if ( $item_qty < $item_min ) {
                                $item_qty = $item_min;
                            }

                            if ( ( $item_max > $item_min ) && ( $item_qty > $item_max ) ) {
                                $item_qty = $item_max;
                            }
                        }

                        $item_class = 'woosb-product woosb-product-type-' . $product->get_type();

                        if ( $optional ) {
                            $item_class .= ' woosb-product-optional';
                        }

                        if ( ! apply_filters( 'woosb_item_visible', true, $product, $global_product_id ) ) {
                            $item_class .= ' woosb-product-hidden';
                        }

                        if ( ( ! $product->is_type( 'variable' ) && ( ! $product->is_in_stock() || ! $product->has_enough_stock( $item_qty ) || ! $this->helper->is_purchasable( $product, 'display' ) ) ) || ( $product->is_type( 'variable' ) && ! $product->child_is_in_stock() && ! $product->child_is_on_backorder() ) ) {
                            if ( ! apply_filters( 'woosb_allow_unpurchasable_qty', false ) ) {
                                $item_qty = 0;
                            }

                            $item_class .= ' woosb-product-unpurchasable';
                        }

                        $item_price = $this->helper->get_price_to_display( $product );
                        $item_link  = apply_filters( 'woosb_item_has_link', $product->is_visible(), $product ) && ( $this->helper->get_setting( 'bundled_link', 'yes' ) !== 'no' );
                        $item_attrs = apply_filters( 'woosb_item_attrs', [
                                'key'          => $key,
                                'name'         => $product->get_name(),
                                'id'           => $product->is_type( 'variable' ) ? 0 : $item['id'],
                                'price'        => $item_price,
                                'o_price'      => $item_price,
                                'price-suffix' => htmlentities( $product->get_price_suffix() ),
                                'stock'        => $product->get_max_purchase_quantity(),
                                'qty'          => $item_qty,
                                'order'        => $order,
                        ], $product, $global_product, $order );

                        do_action( 'woosb_above_item', $product, $global_product, $order );
                        echo '<div class="' . esc_attr( apply_filters( 'woosb_item_class', $item_class, $product, $global_product, $order ) ) . '" ' . $this->helper->data_attributes( $item_attrs ) . '>';
                        do_action( 'woosb_before_item', $product, $global_product, $order );

                        if ( $this->helper->get_setting( 'bundled_thumb', 'yes' ) !== 'no' ) { ?>
                            <div class="woosb-thumb">
                                <?php if ( $item_link ) {
                                    echo '<a ' . ( $this->helper->get_setting( 'bundled_link', 'yes' ) === 'yes_popup' ? 'class="woosq-link no-ajaxy" data-id="' . esc_attr( $item['id'] ) . '" data-context="woosb"' : '' ) . ' href="' . esc_url( $product->get_permalink() ) . '" ' . ( $this->helper->get_setting( 'bundled_link', 'yes' ) === 'yes_blank' ? 'target="_blank"' : '' ) . '>';
                                } ?>
                                <div class="woosb-thumb-ori">
                                    <?php echo apply_filters( 'woosb_item_thumbnail', $product->get_image( $this->helper::get_image_size() ), $product ); ?>
                                </div>
                                <div class="woosb-thumb-new"></div>
                                <?php if ( $item_link ) {
                                    echo '</a>';
                                } ?>
                            </div>
                        <?php } ?>

                        <div class="woosb-title">
                            <?php
                            do_action( 'woosb_before_item_name', $product );

                            echo '<div class="woosb-name">';

                            if ( ( $this->helper->get_setting( 'bundled_qty', 'yes' ) === 'yes' ) && ! $optional ) {
                                echo apply_filters( 'woosb_item_qty', esc_html( $item['qty'] ) . ' × ', $item['qty'], $product );
                            }

                            $item_name    = '';
                            $product_name = apply_filters( 'woosb_item_product_name', $product->get_name(), $product );

                            if ( $item_link ) {
                                $item_name .= '<a ' . ( $this->helper->get_setting( 'bundled_link', 'yes' ) === 'yes_popup' ? 'class="woosq-link no-ajaxy" data-id="' . $item['id'] . '" data-context="woosb"' : '' ) . ' href="' . esc_url( $product->get_permalink() ) . '" ' . ( $this->helper->get_setting( 'bundled_link', 'yes' ) === 'yes_blank' ? 'target="_blank"' : '' ) . '>';
                            }

                            if ( $product->is_type( 'variable' ) || ( $product->is_in_stock() && $product->has_enough_stock( $item_qty ) ) ) {
                                $item_name .= $product_name;
                            } else {
                                $item_name .= '<s>' . $product_name . '</s>';
                            }

                            if ( $item_link ) {
                                $item_name .= '</a>';
                            }

                            echo apply_filters( 'woosb_item_name', $item_name, $product, $global_product, $order );
                            echo '</div>';

                            do_action( 'woosb_after_item_name', $product );

                            if ( $bundled_price === 'price_under_name' || $bundled_price === 'subtotal_under_name' ) {
                                self::show_bundled_price( $bundled_price, $fixed_price, $discount_percentage, $product, $item );
                            }

                            if ( $this->helper->get_setting( 'bundled_description', 'no' ) === 'yes' ) {
                                echo '<div class="woosb-description">' . apply_filters( 'woosb_item_description', $product->is_type( 'variation' ) ? $product->get_description() : $product->get_short_description(), $product ) . '</div>';
                            }

                            echo '<div class="woosb-availability">' . wp_kses_post( wc_get_stock_html( $product ) ) . '</div>';
                            ?>
                        </div>

                        <?php if ( $optional ) {
                            if ( ( $product->is_in_stock() && ( $product->is_type( 'variable' ) || $this->helper->is_purchasable( $product, 'display' ) ) ) || apply_filters( 'woosb_allow_unpurchasable_qty', false ) ) {
                                echo '<div class="' . esc_attr( $this->helper->get_setting( 'plus_minus', 'no' ) === 'yes' ? 'woosb-quantity woosb-quantity-plus-minus' : 'woosb-quantity' ) . '">';

                                if ( $this->helper->get_setting( 'plus_minus', 'no' ) === 'yes' ) {
                                    echo '<div class="woosb-quantity-input">';
                                    echo '<div class="woosb-quantity-input-minus">-</div>';
                                }

                                $qty_args = [
                                        'input_value' => $item_qty,
                                        'min_value'   => $item_min,
                                        'max_value'   => $item_max,
                                        'woosb_qty'   => [
                                                'input_value' => $item_qty,
                                                'min_value'   => $item_min,
                                                'max_value'   => $item_max
                                        ],
                                        'classes'     => apply_filters( 'woosb_qty_classes', [
                                                'input-text',
                                                'woosb-qty',
                                                'woosb_qty',
                                                'qty',
                                                'text'
                                        ] ),
                                        'input_name'  => 'woosb_qty_' . $order
                                    // compatible with WPC Product Quantity
                                ];

                                if ( apply_filters( 'woosb_use_woocommerce_quantity_input', true ) ) {
                                    woocommerce_quantity_input( $qty_args, $product );
                                } else {
                                    echo apply_filters( 'woosb_quantity_input', '<input type="number" class="input-text woosb-qty woosb_qty qty text" value="' . esc_attr( $item_qty ) . '" min="' . esc_attr( $item_min ) . '" max="' . esc_attr( $item_max ) . '" name="' . esc_attr( 'woosb_qty_' . $order ) . '" />', $qty_args, $product );
                                }

                                if ( $this->helper->get_setting( 'plus_minus', 'no' ) === 'yes' ) {
                                    echo '<div class="woosb-quantity-input-plus">+</div>';
                                    echo '</div>';
                                }

                                echo '</div>';
                            } else { ?>
                                <div class="woosb-quantity woosb-quantity-disabled">
                                    <div class="quantity">
                                        <label>
                                            <input type="number" class="input-text woosb-qty woosb_qty qty text"
                                                   value="0" disabled/>
                                        </label>
                                    </div>
                                </div>
                            <?php }
                        }

                        if ( $bundled_price === 'price' || $bundled_price === 'subtotal' ) {
                            self::show_bundled_price( $bundled_price, $fixed_price, $discount_percentage, $product, $item );
                        }

                        do_action( 'woosb_after_item', $product, $global_product, $order );
                        echo '</div><!-- /woosb-product -->';
                        do_action( 'woosb_under_item', $product, $global_product, $order );
                    } elseif ( ! empty( $item['text'] ) ) {
                        $item_class = 'woosb-item-text';

                        if ( ! empty( $item['type'] ) ) {
                            $item_class .= ' woosb-item-text-type-' . $item['type'];
                        }

                        echo '<div class="' . esc_attr( apply_filters( 'woosb_item_text_class', $item_class, $item, $global_product, $order ) ) . '">';

                        if ( empty( $item['type'] ) || ( $item['type'] === 'none' ) ) {
                            echo wp_kses_post( $item['text'] );
                        } else {
                            echo '<' . esc_attr( $item['type'] ) . '>' . wp_kses_post( $item['text'] ) . '</' . esc_attr( $item['type'] ) . '>';
                        }

                        echo '</div>';
                    }

                    $order ++;
                }

                // restore global $product
                $product = $global_product;
                echo '</div><!-- /woosb-products -->';

                if ( ! $fixed_price && ( $has_variables || $has_optional ) ) {
                    echo '<div class="woosb-summary woosb-text"><span class="woosb-total"></span>';

                    if ( $has_optional ) {
                        echo '<span class="woosb-count"></span>';
                    }

                    echo '</div>';
                }

                echo '<div class="woosb-alert woosb-text" style="display: none"></div>';

                do_action( 'woosb_after_table', $product );

                if ( $after_text = apply_filters( 'woosb_after_text', $product->get_meta( 'woosb_after_text' ), $product_id ) ) {
                    echo '<div class="woosb-after-text woosb-text">' . wp_kses_post( do_shortcode( $after_text ) ) . '</div>';
                }

                echo '</div><!-- /woosb-wrap -->';

                do_action( 'woosb_after_wrap', $product );
            }
        }

        function show_bundled_price( $bundled_price, $fixed_price, $discount_percentage, $product, $item ) {
            ?>
            <div class="woosb-price">
                <?php do_action( 'woosb_before_item_price', $product ); ?>
                <div class="woosb-price-ori">
                    <?php
                    $ori_price = (float) $this->helper->round_price( $product->get_price() );
                    $get_price = (float) $this->helper->get_price( $product );

                    if ( ! $fixed_price && $discount_percentage ) {
                        $new_price     = true;
                        $product_price = $get_price * ( 100 - (float) $discount_percentage ) / 100;
                        $product_price = $this->helper->round_price( $product_price );
                        $product_price = apply_filters( 'woosb_item_price_add_to_cart', $product_price, $item );
                    } else {
                        $new_price     = false;
                        $product_price = $get_price;
                    }

                    switch ( $bundled_price ) {
                        case 'price':
                        case 'price_under_name':
                            if ( $new_price ) {
                                $item_price = wc_format_sale_price( wc_get_price_to_display( $product, [ 'price' => $get_price ] ), wc_get_price_to_display( $product, [ 'price' => $product_price ] ) );
                            } else {
                                if ( $get_price > $ori_price ) {
                                    $item_price = wc_price( $this->helper->get_price_to_display( $product ) ) . $product->get_price_suffix();
                                } else {
                                    $item_price = $product->get_price_html();
                                }
                            }

                            break;
                        case 'subtotal':
                        case 'subtotal_under_name':
                            if ( $new_price ) {
                                $item_price = wc_format_sale_price( wc_get_price_to_display( $product, [
                                                'price' => $get_price,
                                                'qty'   => $item['qty']
                                        ] ), wc_get_price_to_display( $product, [
                                                'price' => $product_price,
                                                'qty'   => $item['qty']
                                        ] ) ) . $product->get_price_suffix();
                            } else {
                                $item_price = wc_price( $this->helper->get_price_to_display( $product, $item['qty'] ) ) . $product->get_price_suffix();
                            }

                            break;
                        default:
                            $item_price = $product->get_price_html();
                    }

                    echo apply_filters( 'woosb_item_price', $item_price, $product );
                    ?>
                </div>
                <div class="woosb-price-new"></div>
                <?php do_action( 'woosb_after_item_price', $product ); ?>
            </div>
            <?php
        }

        function show_bundles( $product = null ) {
            if ( ! $product ) {
                global $product;
            }

            if ( ! $product || $product->is_type( 'woosb' ) ) {
                return;
            }

            $product_id = $product->get_id();
            $bundles    = self::get_bundles( $product_id ) ?: [];

            if ( $product->is_type( 'variable' ) && apply_filters( 'woosb_show_bundles_from_variation', false ) ) {
                $children = $product->get_children();

                if ( is_array( $children ) && count( $children ) > 0 ) {
                    foreach ( $children as $child ) {
                        if ( $child_bundles = self::get_bundles( $child ) ) {
                            foreach ( $child_bundles as $child_bundle ) {
                                $bundles[] = $child_bundle;
                            }
                        }
                    }
                }
            }

            if ( ! empty( $bundles ) ) {
                echo '<div class="woosb-bundles">';

                do_action( 'woosb_before_bundles', $product );

                echo '<div class="woosb-products">';

                foreach ( array_unique( $bundles ) as $bundle ) {
                    echo '<div class="woosb-product">';
                    do_action( 'woosb_before_bundles_item', $bundle, $product );
                    echo '<div class="woosb-thumb">' . wp_kses_post( $bundle->get_image( $this->helper::get_image_size() ) ) . '</div>';
                    echo '<div class="woosb-title">';
                    do_action( 'woosb_before_bundles_item_title', $bundle, $product );
                    echo '<a ' . ( $this->helper->get_setting( 'bundled_link', 'yes' ) === 'yes_popup' ? 'class="woosq-link no-ajaxy" data-id="' . esc_attr( $bundle->get_id() ) . '" data-context="woosb"' : '' ) . ' href="' . esc_url( $bundle->get_permalink() ) . '" ' . ( $this->helper->get_setting( 'bundled_link', 'yes' ) === 'yes_blank' ? 'target="_blank"' : '' ) . '>' . esc_html( $bundle->get_name() ) . '</a>';
                    do_action( 'woosb_after_bundles_item_title', $bundle, $product );
                    echo '</div><!-- /woosb-title -->';
                    echo '<div class="woosb-price">' . wp_kses_post( $bundle->get_price_html() ) . '</div>';
                    do_action( 'woosb_after_bundles_item', $bundle, $product );
                    echo '</div><!-- /woosb-product -->';
                }

                echo '</div><!-- /woosb-products -->';
                wp_reset_postdata();

                do_action( 'woosb_after_bundles', $product );

                echo '</div><!-- /woosb-bundles -->';
            }
        }

        function get_bundled( $ids, $product = null ) {
            // moved to helper
            return $this->helper->get_bundled( $ids, $product );
        }

        function get_bundles( $product_id, $per_page = 500, $offset = 0, $context = 'view' ) {
            // moved to helper
            return $this->helper->get_bundles( $product_id, $per_page, $offset, $context );
        }

        function shortcode_form() {
            ob_start();
            self::add_to_cart_form();

            return ob_get_clean();
        }

        function shortcode_bundled() {
            ob_start();
            self::show_bundled();

            return ob_get_clean();
        }

        function shortcode_bundles() {
            ob_start();
            self::show_bundles();

            return ob_get_clean();
        }
    }

    function WPCleverWoosb() {
        return WPCleverWoosb::instance();
    }
}
