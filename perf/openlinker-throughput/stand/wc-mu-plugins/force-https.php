<?php
/**
 * Lab-stand-only mu-plugin (#2854).
 *
 * WordPress core's is_ssl() only ever consults $_SERVER['HTTPS'] /
 * $_SERVER['SERVER_PORT'] - never X-Forwarded-Proto - so a request that
 * reaches this container over plain HTTP from the `wc-tls` nginx proxy (which
 * terminates the real TLS connection and forwards the plaintext leg on the
 * compose network) reads as insecure, and WooCommerce's REST API refuses
 * Basic Auth whenever is_ssl() is false. This file makes the two agree: it
 * runs as a must-use plugin, so it is loaded on every request before
 * WooCommerce's own auth check ever runs.
 *
 * Lab-only: this file is bind-mounted only into docker-compose.lab.yml's
 * woocommerce service, never into the dev/demo stacks.
 */
if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    $_SERVER['HTTPS'] = 'on';
}
