<?php
/**
 * Cron Front Controller
 *
 * Handles cron-triggered webhook delivery.
 *
 * URL:    POST .../index.php?fc=module&module=openlinker&controller=cron
 * Auth:   the cron token, in the X-OpenLinker-Cron-Token header or a `token`
 *         POST field. Never in the query string (#2619).
 *
 * The pass itself lives in DeliveryRunner, so a host that can only run a PHP
 * file - not an HTTP call with a header - delivers through the same code
 * (#2618). This controller is the authenticated HTTP door onto it.
 *
 * The pass processes webhook events from the outbox table:
 * 1. Requeues stale processing rows (recovery from crashes)
 * 2. Claims a batch of pending events (atomic locking)
 * 3. Sends events via HTTP POST with retry/backoff
 * 4. Updates event status (delivered/failed)
 * 5. Runs outbox retention (deletes terminal rows past their horizon)
 *
 * Designed to be called by external cron (e.g., every minute) or PrestaShop's
 * internal cron system.
 *
 * @module prestashop-module/controllers
 * @see {@link DeliveryRunner} for the pass itself
 * @see {@link CronTokenVerifier} for the token check
 *
 * @author OpenLinker Team
 * @version 1.0.0
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

class OpenLinkerCronModuleFrontController extends ModuleFrontController
{
    public function initContent()
    {
        parent::initContent();

        $classesDir = dirname(__FILE__) . '/../../classes/';
        require_once($classesDir . 'CronTokenVerifier.php');

        // A token in the URL is the pre-1.6.0 install instruction, and it is
        // refused now. Answered before the method check so the operator whose
        // old GET cron just stopped working reads why, instead of a bare 405.
        if (CronTokenVerifier::hasQueryStringToken($_GET)) {
            http_response_code(403);
            header('Content-Type: application/json');
            echo json_encode([
                'error' => 'Forbidden',
                'message' => 'The cron token is no longer read from the URL, because a URL is'
                    . ' written to server logs and browser history. Use the cron file'
                    . ' shipped with the module, or POST the token in the'
                    . ' X-OpenLinker-Cron-Token header.'
            ]);
            exit;
        }

        // Only POST is meaningful: delivery changes state, and refusing the
        // wrong method costs nothing.
        if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') {
            http_response_code(405);
            header('Content-Type: application/json');
            echo json_encode([
                'error' => 'Method Not Allowed',
                'message' => 'Send the delivery request as POST.'
            ]);
            exit;
        }

        $token = CronTokenVerifier::presentedToken($_SERVER, $_POST);
        $expectedToken = (string) Configuration::get('OPENLINKER_CRON_TOKEN');

        if (!CronTokenVerifier::matches($token, $expectedToken)) {
            http_response_code(403);
            header('Content-Type: application/json');
            echo json_encode([
                'error' => 'Forbidden',
                // Identical for a wrong token and a missing one, so the
                // endpoint is not an oracle for which tokens exist.
                'message' => 'Invalid or missing token'
            ]);
            exit;
        }

        require_once($classesDir . 'DeliveryRunner.php');

        try {
            $stats = DeliveryRunner::run('http');

            header('Content-Type: application/json');
            echo json_encode($stats);
        } catch (Exception $e) {
            http_response_code(500);
            header('Content-Type: application/json');
            echo json_encode([
                'error' => 'Internal Server Error',
                'message' => 'Cron delivery failed: ' . WebhookSender::getErrorMessage($e)
            ]);
        }
    }
}
