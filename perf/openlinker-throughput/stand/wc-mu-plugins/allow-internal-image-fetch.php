<?php
/**
 * Lab-stand-only mu-plugin (#3046).
 *
 * WordPress core's wp_http_validate_url() (wp-includes/http.php) refuses to
 * fetch a remote URL whose host resolves to an RFC1918 private address
 * UNLESS that host matches the site's own `home` option, or the
 * `http_request_host_is_external` filter says otherwise. The shop-publish
 * image-upload path (WooCommerce's `WC_REST_Products_Controller` ->
 * `media_handle_sideload` -> `download_url` -> `wp_safe_remote_get`) always
 * goes through this "safe" variant, so it always hits the check.
 *
 * On this lab stand every product-master host (`prestashop.lab`) resolves to
 * a container IP inside Docker's default 172.16.0.0/12 bridge range - which
 * is exactly one of the four ranges this check treats as "local, reject
 * unless explicitly allowed" (confirmed live: `prestashop.lab` -> 172.22.x.x,
 * second octet 22 falls inside [16,31]). Renaming the host to carry a dot
 * (#3046's `prestashop.lab` alias) fixed WordPress's SEPARATE dot-less-host
 * rejection, but this is a second, independent check in the same function -
 * the two must not be confused as one fix.
 *
 * Lab-only: bind-mounted only into docker-compose.lab.yml's woocommerce
 * service, never into the dev/demo stacks - a real production WooCommerce
 * install should never disable this check wholesale.
 */
add_filter('http_request_host_is_external', '__return_true');
