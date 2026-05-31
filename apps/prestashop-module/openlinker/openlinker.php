<?php
/**
 * OpenLinker PrestaShop Module
 *
 * Host module for OpenLinker capabilities on PrestaShop. Provides two
 * capabilities side-by-side:
 *
 *   1. Webhook outbox — captures PrestaShop events (product/order/stock) via
 *      hooks, writes to a durable outbox table, delivers to OpenLinker via
 *      HMAC-signed HTTP POST with retry/backoff.
 *   2. Dynamic shipping carrier — registers an OL-owned carrier with
 *      is_module=1 + shipping_external=1 on install. The OL backend writes
 *      per-cart shipping costs to a sidecar table via the cartshipping
 *      front-controller endpoint; PrestaShop calls
 *      getOrderShippingCostExternal() at order-create time and reads the
 *      authoritative amount from the sidecar — no post-create reconcile.
 *   3. Order import — the `importorder` front controller creates orders
 *      through PrestaShop's canonical PaymentModule::validateOrder flow
 *      (delegated to ps_checkpayment), instead of the raw webservice
 *      POST /orders insert that bypassed validateOrder and dropped the
 *      carrier / recomputed shipping (ADR-016 / #905). The dynamic carrier
 *      is installed need_range=1 + groups + ranges so validateOrder's
 *      carrier resolution surfaces it.
 *
 * Extends CarrierModule (not Module) so the carrier capability is declared
 * formally per the canonical PS pattern. CarrierModule itself extends Module,
 * so the webhook-outbox behaviour is unchanged.
 *
 * @module prestashop-module
 * @see {@link OutboxRepository} for outbox persistence and state management
 * @see {@link WebhookSender} for HTTP delivery with HMAC signatures
 * @see {@link EventIdGenerator} for deterministic event ID generation
 * @see {@link CartShippingRepository} for dynamic-carrier sidecar I/O
 * @see {@link HmacRequestVerifier} for inbound HMAC verification
 *
 * @author OpenLinker Team
 * @version 1.2.0
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * Class Autoloading Note:
 *
 * PrestaShop does not provide automatic class autoloading for custom module classes.
 * This module uses explicit require_once() calls before using classes to ensure
 * they are loaded. This approach:
 * - Works reliably across all PrestaShop versions
 * - Avoids autoloader conflicts
 * - Makes dependencies explicit
 *
 * Classes are loaded on-demand in methods that use them, with class_exists()
 * checks to prevent duplicate loading.
 */
class OpenLinker extends CarrierModule
{
    // Configuration defaults
    const DEFAULT_BATCH_SIZE = 50;
    const DEFAULT_MAX_RETRY_ATTEMPTS = 25;
    const DEFAULT_RETRY_BACKOFF_MULTIPLIER = 2.0;
    const DEFAULT_DEDUPLICATION_WINDOW_MINUTES = 1;

    // Dynamic shipping carrier — display name shown in PS admin carrier list.
    const DYNAMIC_CARRIER_NAME = 'OpenLinker Dynamic';
    // Configuration key holding the live id_carrier of the OL Dynamic carrier.
    // Refreshed automatically by hookActionCarrierUpdate when an operator
    // edits the carrier in PS admin (PS duplicates the row and assigns a new id).
    const DYNAMIC_CARRIER_CONFIG_KEY = 'OPENLINKER_DYNAMIC_CARRIER_ID';

    // When '1', emails fire on OL-imported orders (validateOrder); default '0'
    // suppresses them — the marketplace already notified the buyer, so a
    // duplicate PS mail is unwanted (#905). NOTE: suppression is coarse — it
    // cancels EVERY mail validateOrder triggers in that window, which is the
    // buyer order-confirmation + state mail today, but would also include a
    // merchant "new order" notification if one is configured. The window is
    // narrow (only around the single validateOrder call), so normal shop mail
    // outside OL imports is never affected. Set to '1' to let all of them fire.
    const IMPORT_SEND_MAIL_CONFIG_KEY = 'OPENLINKER_IMPORT_SEND_MAIL';

    /**
     * Request-scoped flag set by the importorder controller around its
     * `validateOrder` call. While true, `hookActionEmailSendBefore` cancels
     * every outbound mail (validateOrder's only mails in that window are the
     * order-confirmation + state emails we intend to suppress). Static so the
     * front controller and the hook — separate objects in the same PHP
     * request — share it; PHP resets it per request.
     */
    public static $suppressImportMail = false;

    public function __construct()
    {
        $this->name = 'openlinker';
        $this->tab = 'administration';
        $this->version = '1.2.0';
        $this->author = 'OpenLinker Team';
        $this->need_instance = 0;
        $this->ps_versions_compliancy = [
            'min' => '8.0',
            'max' => _PS_VERSION_,
        ];
        $this->bootstrap = true;

        parent::__construct();

        $this->displayName = $this->l('OpenLinker');
        $this->description = $this->l('OpenLinker PrestaShop module: emits webhook events for event-driven sync and hosts additional OpenLinker capabilities.');
    }

    /**
     * Install module
     *
     * @return bool
     */
    public function install()
    {
        // Register hooks. actionCarrierUpdate is required for the dynamic
        // carrier capability — PS duplicates carrier rows on BO edit and
        // reassigns id_carrier; the hook keeps DYNAMIC_CARRIER_CONFIG_KEY
        // in sync with the live row.
        $hooks = [
            'actionProductSave',
            'actionValidateOrderAfter',
            'actionOrderHistoryAddAfter',
            'actionUpdateQuantity',
            'actionCarrierUpdate',
            'actionEmailSendBefore',
        ];

        if (!parent::install()) {
            return false;
        }

        foreach ($hooks as $hook) {
            if (!$this->registerHook($hook)) {
                return false;
            }
        }

        // Create outbox table (webhook capability)
        if (!$this->createOutboxTable()) {
            return false;
        }

        // Create cart-shipping sidecar table (dynamic-carrier capability)
        if (!$this->createCartShippingTable()) {
            return false;
        }

        // Set default configuration
        $this->setDefaultConfiguration();

        // Install custom tab in main menu
        if (!$this->installTab()) {
            return false;
        }

        // Register the OL Dynamic carrier (dynamic-carrier capability)
        if (!$this->installDynamicCarrier()) {
            return false;
        }

        return true;
    }

    /**
     * Uninstall module
     *
     * @return bool
     */
    public function uninstall()
    {
        // Remove hooks
        $hooks = [
            'actionProductSave',
            'actionValidateOrderAfter',
            'actionOrderHistoryAddAfter',
            'actionUpdateQuantity',
            'actionCarrierUpdate',
            'actionEmailSendBefore',
        ];

        foreach ($hooks as $hook) {
            $this->unregisterHook($hook);
        }

        // Soft-delete the OL Dynamic carrier and (if needed) reassign
        // PS_CARRIER_DEFAULT first so checkout doesn't break.
        $this->uninstallDynamicCarrier();

        // Clear configuration
        $this->clearConfiguration();

        // Remove custom tab from main menu
        $this->uninstallTab();

        // Optionally drop outbox table (or keep for audit)
        // Uncomment if you want to drop the table on uninstall:
        // $this->dropOutboxTable();

        // Optionally drop cart-shipping sidecar table (or keep for audit)
        // Same opt-in pattern as the outbox table — orders never reference
        // the sidecar after order-create, so dropping it is usually safe,
        // but kept commented to match the conservative outbox default.
        // $this->dropCartShippingTable();

        return parent::uninstall();
    }

    /**
     * Configuration page content
     *
     * Handles form submission, validation, and renders configuration template.
     *
     * @return string HTML content
     */
    public function getContent()
    {
        $output = '';

        // Handle form submission
        if (Tools::isSubmit('submit' . $this->name)) {
            $output .= $this->processConfigurationForm();
        }

        // Handle test connection
        if (Tools::isSubmit('testConnection')) {
            $output .= $this->processTestConnection();
        }

        // Handle manual delivery trigger
        if (Tools::isSubmit('runDeliveryNow')) {
            $output .= $this->processManualDelivery();
        }

        // Render configuration template
        $this->context->smarty->assign([
            'module_dir' => $this->_path,
            'module_name' => $this->name,
            'token' => Tools::getAdminTokenLite('AdminModules'),
            'form_action' => $this->context->link->getAdminLink('AdminModules', true) . '&configure=' . $this->name . '&tab_module=' . $this->tab . '&module_name=' . $this->name,
            'base_url' => Configuration::get('OPENLINKER_BASE_URL'),
            'connection_id' => Configuration::get('OPENLINKER_CONNECTION_ID'),
            'webhook_secret' => Configuration::get('OPENLINKER_WEBHOOK_SECRET'),
            'cron_token' => Configuration::get('OPENLINKER_CRON_TOKEN'),
            'enable_product_events' => Configuration::get('ENABLE_PRODUCT_EVENTS'),
            'enable_stock_events' => Configuration::get('ENABLE_STOCK_EVENTS'),
            'enable_order_events' => Configuration::get('ENABLE_ORDER_EVENTS'),
            'batch_size' => Configuration::get('BATCH_SIZE') ?: self::DEFAULT_BATCH_SIZE,
            'max_retry_attempts' => Configuration::get('MAX_RETRY_ATTEMPTS') ?: self::DEFAULT_MAX_RETRY_ATTEMPTS,
            'retry_backoff_multiplier' => Configuration::get('RETRY_BACKOFF_MULTIPLIER') ?: self::DEFAULT_RETRY_BACKOFF_MULTIPLIER,
            'deduplication_window_minutes' => Configuration::get('DEDUPLICATION_WINDOW_MINUTES') ?: self::DEFAULT_DEDUPLICATION_WINDOW_MINUTES,
            'statistics' => $this->getStatistics(),
        ]);

        return $output . $this->display(__FILE__, 'views/templates/admin/configure.tpl');
    }

    /**
     * Process configuration form submission
     *
     * @return string Success/error messages
     */
    private function processConfigurationForm()
    {
        $errors = [];

        // Validate and save base URL
        $baseUrl = Tools::getValue('OPENLINKER_BASE_URL');
        if (empty($baseUrl)) {
            $errors[] = $this->l('Base URL is required');
        } elseif (!filter_var($baseUrl, FILTER_VALIDATE_URL)) {
            $errors[] = $this->l('Base URL must be a valid URL');
        } else {
            Configuration::updateValue('OPENLINKER_BASE_URL', $baseUrl);
        }

        // Validate and save connection ID (UUID format)
        $connectionId = trim(Tools::getValue('OPENLINKER_CONNECTION_ID'));
        if (empty($connectionId)) {
            $errors[] = $this->l('Connection ID is required');
        } elseif (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $connectionId)) {
            $errors[] = $this->l('Connection ID must be a valid UUID');
        } else {
            Configuration::updateValue('OPENLINKER_CONNECTION_ID', $connectionId);
        }

        // Validate and save webhook secret
        $webhookSecret = Tools::getValue('OPENLINKER_WEBHOOK_SECRET');
        if (empty($webhookSecret)) {
            $errors[] = $this->l('Webhook secret is required');
        } else {
            Configuration::updateValue('OPENLINKER_WEBHOOK_SECRET', $webhookSecret);
        }

        // Save cron token (regenerate if requested)
        if (Tools::getValue('regenerate_cron_token')) {
            $cronToken = $this->generateRandomToken();
            Configuration::updateValue('OPENLINKER_CRON_TOKEN', $cronToken);
        } else {
            $cronToken = Tools::getValue('OPENLINKER_CRON_TOKEN');
            if (!empty($cronToken)) {
                Configuration::updateValue('OPENLINKER_CRON_TOKEN', $cronToken);
            }
        }

        // Save event type toggles
        Configuration::updateValue('ENABLE_PRODUCT_EVENTS', (int)Tools::getValue('ENABLE_PRODUCT_EVENTS'));
        Configuration::updateValue('ENABLE_STOCK_EVENTS', (int)Tools::getValue('ENABLE_STOCK_EVENTS'));
        Configuration::updateValue('ENABLE_ORDER_EVENTS', (int)Tools::getValue('ENABLE_ORDER_EVENTS'));

        // Validate and save advanced settings
            $batchSize = (int)Tools::getValue('BATCH_SIZE');
            if ($batchSize < 1 || $batchSize > 200) {
                $errors[] = $this->l('Batch size must be between 1 and 200');
            } else {
                Configuration::updateValue('BATCH_SIZE', $batchSize);
            }

            $maxRetryAttempts = (int)Tools::getValue('MAX_RETRY_ATTEMPTS');
            if ($maxRetryAttempts < 1 || $maxRetryAttempts > 100) {
                $errors[] = $this->l('Max retry attempts must be between 1 and 100');
            } else {
                Configuration::updateValue('MAX_RETRY_ATTEMPTS', $maxRetryAttempts);
            }

            $backoffMultiplier = (float)Tools::getValue('RETRY_BACKOFF_MULTIPLIER');
            if ($backoffMultiplier < 1.0) {
                $errors[] = $this->l('Retry backoff multiplier must be at least 1.0');
            } else {
                Configuration::updateValue('RETRY_BACKOFF_MULTIPLIER', $backoffMultiplier);
            }

            // Deduplication window (in minutes)
            $deduplicationWindow = (int)Tools::getValue('DEDUPLICATION_WINDOW_MINUTES');
            if ($deduplicationWindow < 1 || $deduplicationWindow > 60) {
                $errors[] = $this->l('Deduplication window must be between 1 and 60 minutes');
            } else {
                Configuration::updateValue('DEDUPLICATION_WINDOW_MINUTES', $deduplicationWindow);
            }

        // Return messages
        if (!empty($errors)) {
            return $this->displayError(implode('<br />', $errors));
        }

        return $this->displayConfirmation($this->l('Configuration saved successfully'));
    }

    /**
     * Process test connection request
     *
     * @return string Success/error messages
     */
    private function processTestConnection()
    {
        try {
            $connectionId = Configuration::get('OPENLINKER_CONNECTION_ID');
            if (empty($connectionId)) {
                return $this->displayError($this->l('Connection ID not configured'));
            }

            // Ensure all required classes are loaded
            $classesDir = dirname(__FILE__) . '/classes/';
            
            if (!class_exists('EventIdGenerator')) {
                require_once($classesDir . 'EventIdGenerator.php');
            }
            if (!class_exists('OutboxEvent')) {
                require_once($classesDir . 'OutboxEvent.php');
            }
            if (!class_exists('OutboxRepository')) {
                require_once($classesDir . 'OutboxRepository.php');
            }
            if (!class_exists('WebhookSender')) {
                require_once($classesDir . 'WebhookSender.php');
            }

            // Enqueue test event
            $repository = new OutboxRepository();
            $testEventId = $repository->enqueueEvent([
                'eventId' => 'test-' . uniqid(),
                'connectionId' => $connectionId,
                'eventType' => 'test.ping',
                'objectType' => 'test',
                'externalId' => 'test',
                'occurredAt' => date('Y-m-d H:i:s'),
                'payloadJson' => json_encode(['test' => true]),
            ]);

            // Immediately trigger delivery (process one event)
            $sender = new WebhookSender();
            $runId = uniqid('test_', true);
            $events = $repository->claimBatchDueForDelivery(1, $runId);

            if (empty($events)) {
                return $this->displayError($this->l('Failed to claim test event'));
            }

            $event = $events[0];
            $success = $sender->sendEvent($event);

            if ($success) {
                $repository->markDelivered($event->id);
                return $this->displayConfirmation($this->l('Test connection successful! Event delivered to OpenLinker.'));
            } else {
                $repository->scheduleRetry($event->id, 0, 'Test connection failed');
                return $this->displayError($this->l('Test connection failed. Check logs for details.'));
            }
        } catch (Exception $e) {
            // Log the full error for debugging
            PrestaShopLogger::addLog(
                'OpenLinker:Test connection error: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString(),
                3, // Error level
                null,
                'Module',
                null
            );
            
            // Return user-friendly error message
            if (class_exists('WebhookSender') && method_exists('WebhookSender', 'getErrorMessage')) {
                $errorMessage = WebhookSender::getErrorMessage($e);
            } else {
                $errorMessage = $e->getMessage();
            }
            
            return $this->displayError($this->l('Test connection failed: ') . htmlspecialchars($errorMessage, ENT_QUOTES, 'UTF-8'));
        } catch (Throwable $e) {
            // Catch PHP 7+ fatal errors and other throwables
            PrestaShopLogger::addLog(
                'OpenLinker:Test connection fatal error: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString(),
                3,
                null,
                'Module',
                null
            );
            
            return $this->displayError($this->l('Test connection failed: ') . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8'));
        }
    }

    /**
     * Process manual delivery trigger
     *
     * @return string Success/error messages
     */
    private function processManualDelivery()
    {
        try {
            // Ensure classes are loaded
            $classesDir = dirname(__FILE__) . '/classes/';
            
            if (!class_exists('EventIdGenerator')) {
                require_once($classesDir . 'EventIdGenerator.php');
            }
            if (!class_exists('OutboxEvent')) {
                require_once($classesDir . 'OutboxEvent.php');
            }
            if (!class_exists('OutboxRepository')) {
                require_once($classesDir . 'OutboxRepository.php');
            }
            if (!class_exists('WebhookSender')) {
                require_once($classesDir . 'WebhookSender.php');
            }

            // Trigger delivery via cron logic
            $repository = new OutboxRepository();
            $sender = new WebhookSender();

            // Requeue stale rows (older than threshold defined in OutboxRepository)
            $requeued = $repository->requeueStaleProcessingRows();
            
            // Also requeue all processing rows for manual delivery (user explicitly wants to retry)
            // This ensures any stuck events are immediately available for delivery
            $requeued += $repository->requeueAllProcessingRows();
            
            // Reset next_attempt_at for pending events scheduled for future delivery
            // This allows manual delivery to process all pending events immediately,
            // regardless of their scheduled retry time
            $resetCount = $repository->resetNextAttemptForPendingEvents();

            // Get batch size
            $batchSize = (int)Configuration::get('BATCH_SIZE') ?: self::DEFAULT_BATCH_SIZE;

            // Claim batch
            $runId = uniqid('manual_', true);
            $events = $repository->claimBatchDueForDelivery($batchSize, $runId);

            if (empty($events)) {
                return $this->displayConfirmation($this->l('No events due for delivery.'));
            }

            // Process events
            $delivered = 0;
            $failed = 0;

            foreach ($events as $event) {
                try {
                    PrestaShopLogger::addLog(
                        'OpenLinker:Attempting to deliver event ' . $event->id . ' (eventId: ' . $event->event_id . ', type: ' . $event->event_type . ')',
                        1, // Info level
                        null,
                        'Module',
                        null
                    );
                    
                    $success = $sender->sendEvent($event);
                    if ($success) {
                        $repository->markDelivered($event->id);
                        $delivered++;
                        PrestaShopLogger::addLog(
                            'OpenLinker:Successfully delivered event ' . $event->id,
                            1,
                            null,
                            'Module',
                            null
                        );
                    } else {
                        // Send failed - schedule retry
                        $repository->scheduleRetry($event->id, $event->attempts, 'Manual delivery failed');
                        $failed++;
                        PrestaShopLogger::addLog(
                            'OpenLinker:Event ' . $event->id . ' delivery returned false, scheduled retry',
                            2, // Warning level
                            null,
                            'Module',
                            null
                        );
                    }
                } catch (Exception $e) {
                    $errorMessage = WebhookSender::getErrorMessage($e);
                    $maxAttempts = (int)Configuration::get('MAX_RETRY_ATTEMPTS') ?: self::DEFAULT_MAX_RETRY_ATTEMPTS;

                    PrestaShopLogger::addLog(
                        'OpenLinker:Event ' . $event->id . ' delivery failed: ' . $errorMessage . ' (attempts: ' . $event->attempts . '/' . $maxAttempts . ')',
                        2, // Warning level
                        null,
                        'Module',
                        null
                    );

                    if ($event->attempts >= $maxAttempts) {
                        $repository->markFailed($event->id, $errorMessage);
                    } else {
                        $repository->scheduleRetry($event->id, $event->attempts, $errorMessage);
                    }
                    $failed++;
                } catch (Throwable $e) {
                    // Catch fatal errors
                    $errorMessage = $e->getMessage();
                    $maxAttempts = (int)Configuration::get('MAX_RETRY_ATTEMPTS') ?: self::DEFAULT_MAX_RETRY_ATTEMPTS;

                    PrestaShopLogger::addLog(
                        'OpenLinker:Event ' . $event->id . ' fatal error: ' . $errorMessage,
                        3, // Error level
                        null,
                        'Module',
                        null
                    );

                    if ($event->attempts >= $maxAttempts) {
                        $repository->markFailed($event->id, $errorMessage);
                    } else {
                        $repository->scheduleRetry($event->id, $event->attempts, $errorMessage);
                    }
                    $failed++;
                }
            }

            // Build user-friendly message
            $messageParts = [];
            $messageParts[] = sprintf('%d event(s) processed', count($events));
            if ($delivered > 0) {
                $messageParts[] = sprintf('%d delivered', $delivered);
            }
            if ($failed > 0) {
                $messageParts[] = sprintf('%d failed', $failed);
            }
            if ($requeued > 0) {
                $messageParts[] = sprintf('%d requeued', $requeued);
            }
            if ($resetCount > 0) {
                $messageParts[] = sprintf('%d scheduled event(s) made available', $resetCount);
            }
            
            $message = implode(', ', $messageParts);

            return $this->displayConfirmation($this->l($message));
        } catch (Exception $e) {
            // If outer exception, requeue any events that were claimed but not processed
            // This prevents events from getting stuck in processing state
            try {
                if (isset($repository) && isset($runId)) {
                    $repository->requeueEventsByRunId($runId, 'Manual delivery failed: ' . $e->getMessage());
                }
            } catch (Exception $cleanupError) {
                // Log cleanup error but don't fail the main error
                PrestaShopLogger::addLog(
                    'OpenLinker:Failed to cleanup events after error: ' . $cleanupError->getMessage(),
                    3,
                    null,
                    'Module',
                    null
                );
            }
            
            PrestaShopLogger::addLog(
                'OpenLinker:Manual delivery failed: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString(),
                3,
                null,
                'Module',
                null
            );
            
            return $this->displayError($this->l('Manual delivery failed: ') . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8'));
        } catch (Throwable $e) {
            // Catch fatal errors
            try {
                if (isset($repository) && isset($runId)) {
                    $repository->requeueEventsByRunId($runId, 'Manual delivery fatal error: ' . $e->getMessage());
                }
            } catch (Exception $cleanupError) {
                PrestaShopLogger::addLog(
                    'OpenLinker:Failed to cleanup events after fatal error: ' . $cleanupError->getMessage(),
                    3,
                    null,
                    'Module',
                    null
                );
            }
            
            PrestaShopLogger::addLog(
                'OpenLinker:Manual delivery fatal error: ' . $e->getMessage(),
                3,
                null,
                'Module',
                null
            );
            
            return $this->displayError($this->l('Manual delivery failed: ') . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8'));
        }
    }

    /**
     * Get statistics for diagnostics
     *
     * @return array Statistics
     */
    private function getStatistics()
    {
        try {
            // Ensure class is loaded (PrestaShop autoloader should handle this, but safety check)
            if (!class_exists('OutboxRepository')) {
                // Try to load manually if autoloader didn't work
                require_once(dirname(__FILE__) . '/classes/OutboxRepository.php');
            }
            
            $repository = new OutboxRepository();
            $stats = $repository->getStatistics();
            
            // Debug logging (can be removed in production)
            PrestaShopLogger::addLog(
                'OpenLinker:Statistics - pending: ' . $stats['pending'] . ', processing: ' . $stats['processing'],
                1, // Info level
                null,
                'Module',
                null
            );
            
            return $stats;
        } catch (Exception $e) {
            // Log error but don't break the page
            PrestaShopLogger::addLog(
                'OpenLinker:Failed to get statistics: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString(),
                3, // Error level
                null,
                'Module',
                null
            );
            
            return [
                'pending' => 0,
                'processing' => 0,
                'failed' => 0,
                'delivered_24h' => 0,
                'last_delivery' => null,
                'last_error' => 'Error: ' . $e->getMessage(),
            ];
        } catch (Throwable $e) {
            PrestaShopLogger::addLog(
                'OpenLinker:Fatal error in getStatistics: ' . $e->getMessage(),
                3,
                null,
                'Module',
                null
            );
            
            return [
                'pending' => 0,
                'processing' => 0,
                'failed' => 0,
                'delivered_24h' => 0,
                'last_delivery' => null,
                'last_error' => 'Fatal error: ' . $e->getMessage(),
            ];
        }
    }

    /**
     * Create outbox table
     *
     * @return bool
     */
    private function createOutboxTable()
    {
        $sql = 'CREATE TABLE IF NOT EXISTS `' . _DB_PREFIX_ . 'openlinker_webhook_outbox` (
            `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
            `event_id` VARCHAR(255) NOT NULL,
            `schema_version` INT(11) NOT NULL DEFAULT 1,
            `provider` VARCHAR(50) NOT NULL DEFAULT "prestashop",
            `connection_id` VARCHAR(255) NOT NULL,
            `event_type` VARCHAR(100) NOT NULL,
            `object_type` VARCHAR(50) NOT NULL,
            `external_id` VARCHAR(255) NOT NULL,
            `occurred_at` DATETIME NOT NULL,
            `payload_json` TEXT NULL,
            `status` ENUM("pending", "processing", "delivered", "failed") NOT NULL DEFAULT "pending",
            `attempts` INT(11) NOT NULL DEFAULT 0,
            `next_attempt_at` DATETIME NULL,
            `last_error` TEXT NULL,
            `processing_owner` VARCHAR(64) NULL,
            `processing_started_at` DATETIME NULL,
            `created_at` DATETIME NOT NULL,
            `updated_at` DATETIME NOT NULL,
            `delivered_at` DATETIME NULL,
            PRIMARY KEY (`id`),
            UNIQUE KEY `event_id` (`event_id`),
            KEY `status_next_attempt_created` (`status`, `next_attempt_at`, `created_at`),
            KEY `processing_owner_started` (`processing_owner`, `processing_started_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';

        return Db::getInstance()->execute($sql);
    }

    /**
     * Drop outbox table (optional, for uninstall)
     *
     * @return bool
     */
    private function dropOutboxTable()
    {
        $sql = 'DROP TABLE IF EXISTS `' . _DB_PREFIX_ . 'openlinker_webhook_outbox`;';
        return Db::getInstance()->execute($sql);
    }

    /**
     * Create cart-shipping sidecar table
     *
     * Stores per-cart shipping costs written by the OpenLinker backend before
     * order-create; read by getOrderShippingCostExternal() at order-create time.
     *
     * @return bool
     */
    private function createCartShippingTable()
    {
        $sql = 'CREATE TABLE IF NOT EXISTS `' . _DB_PREFIX_ . 'openlinker_cart_shipping` (
            `id_cart` INT(11) UNSIGNED NOT NULL,
            `amount_tax_excl` DECIMAL(20,6) NOT NULL,
            `amount_tax_incl` DECIMAL(20,6) NOT NULL,
            `source` VARCHAR(255) NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id_cart`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';

        return Db::getInstance()->execute($sql);
    }

    /**
     * Drop cart-shipping sidecar table (optional, for uninstall)
     *
     * @return bool
     */
    private function dropCartShippingTable()
    {
        $sql = 'DROP TABLE IF EXISTS `' . _DB_PREFIX_ . 'openlinker_cart_shipping`;';
        return Db::getInstance()->execute($sql);
    }

    /**
     * Register the OL Dynamic carrier on install
     *
     * Creates a single Carrier row with is_module=1 + shipping_external=1 so
     * PS routes shipping-cost queries through this module's
     * getOrderShippingCostExternal() at order-create time. Logo copy is
     * fail-fast — install aborts if the file is missing or unwritable
     * (matches LP Express + standard PS carrier-module behaviour).
     *
     * @return bool
     */
    private function installDynamicCarrier()
    {
        $carrier = new Carrier();
        $carrier->name              = self::DYNAMIC_CARRIER_NAME;
        $carrier->active            = 1;
        $carrier->deleted           = 0;
        $carrier->shipping_handling = false;
        $carrier->range_behavior    = 0;
        $carrier->is_module         = true;
        $carrier->shipping_external = true;
        $carrier->external_module_name = $this->name;
        // CRITICAL (ADR-016 / #905): need_range=1 + a catch-all price range is
        // what makes PaymentModule::validateOrder's carrier resolution SURFACE
        // this carrier — `Carrier::getCarriersForOrder` gathers via
        // `(is_module=0 OR need_range=1)`, so a need_range=0 module carrier is
        // never offered at checkout/order-create and PS silently falls back to
        // the cheapest (free) carrier. The range price (0) is ignored: PS calls
        // getOrderShippingCostExternal() (the sidecar amount) for the real cost.
        $carrier->shipping_method   = Carrier::SHIPPING_METHOD_PRICE;
        $carrier->need_range        = true;
        // CRITICAL: OL supplies an authoritative tax-incl amount via the
        // sidecar. id_tax_rules_group=0 means PS does NOT add tax on top —
        // otherwise every order would be double-taxed (PS would multiply
        // our tax-incl value by the shop tax rate).
        $carrier->id_tax_rules_group = 0;

        foreach (Language::getLanguages(true) as $lang) {
            $carrier->delay[(int) $lang['id_lang']] = 'OpenLinker dynamic shipping';
        }

        if (!$carrier->add()) {
            PrestaShopLogger::addLog(
                'OpenLinker: Carrier::add() failed for OL Dynamic carrier',
                3, null, 'Module', null
            );
            return false;
        }

        // Assign all currently-active zones — operator can prune from the
        // PS carrier admin page after install. An aggregator cannot pre-pick
        // zones for the operator's market.
        foreach (Zone::getZones(true) as $zone) {
            $carrier->addZone((int) $zone['id_zone']);
        }

        // Grant the carrier to every customer group. Without this the carrier
        // is unavailable to real customers, so PaymentModule::validateOrder's
        // delivery-option resolution silently drops it for the shop's default
        // (free) carrier — the #898 failure mode. Operators can prune in the PS
        // carrier admin afterwards. See ADR-016 / #905.
        $carrier->setGroups(array_map(
            static function ($group) {
                return (int) $group['id_group'];
            },
            Group::getGroups((int) Configuration::get('PS_LANG_DEFAULT'))
        ));

        // Catch-all price range + per-zone delivery rows. Required for the
        // carrier to pass `getCarriersForOrder`'s in-range check (price method,
        // need_range=1). The delivery price is 0 and never used — the module's
        // getOrderShippingCostExternal() overrides it with the sidecar amount.
        if (!$this->configureDynamicCarrierRanges((int) $carrier->id)) {
            PrestaShopLogger::addLog(
                'OpenLinker: failed to configure ranges for OL Dynamic carrier id=' . (int) $carrier->id,
                3, null, 'Module', null
            );
            return false;
        }

        // Logo is required — PS otherwise shows the broken-image placeholder
        // in the carrier list. Production PS modules treat copy-failure as
        // install failure (LP Express pattern); we follow suit.
        $logoSrc = dirname(__FILE__) . '/carrier.jpg';
        $logoDst = _PS_SHIP_IMG_DIR_ . '/' . (int) $carrier->id . '.jpg';
        if (!@copy($logoSrc, $logoDst)) {
            PrestaShopLogger::addLog(
                'OpenLinker: failed to copy carrier logo from ' . $logoSrc
                . ' to ' . $logoDst,
                3, null, 'Module', null
            );
            return false;
        }

        Configuration::updateValue(
            self::DYNAMIC_CARRIER_CONFIG_KEY,
            (int) $carrier->id
        );

        return true;
    }

    /**
     * Configure the catch-all price range + per-zone delivery rows for the OL
     * Dynamic carrier.
     *
     * Idempotent and row-preserving: clears any existing OL ranges/delivery
     * rows for the carrier first, then re-creates a single 0→∞ price range and
     * one delivery row per active zone (price 0 — the module overrides it). Safe
     * to call from both `installDynamicCarrier` (fresh) and the upgrade hook
     * (existing carrier row, ADR-016 / #905) because it never touches the
     * `ps_carrier` row itself, so `id_carrier` — and every order referencing it
     * — is preserved.
     *
     * @param int $idCarrier
     * @return bool
     */
    private function configureDynamicCarrierRanges($idCarrier)
    {
        if ($idCarrier <= 0) {
            return false;
        }

        $db = Db::getInstance();
        // Idempotent reset — drop prior OL-managed ranges/delivery rows.
        $db->execute('DELETE FROM `' . _DB_PREFIX_ . 'delivery` WHERE id_carrier = ' . (int) $idCarrier);
        $db->execute('DELETE FROM `' . _DB_PREFIX_ . 'range_price` WHERE id_carrier = ' . (int) $idCarrier);

        $rangePrice = new RangePrice();
        $rangePrice->id_carrier = (int) $idCarrier;
        $rangePrice->delimiter1 = '0';
        $rangePrice->delimiter2 = '10000000';
        if (!$rangePrice->add()) {
            return false;
        }

        foreach (Zone::getZones(true) as $zone) {
            $ok = $db->insert('delivery', [
                'id_carrier' => (int) $idCarrier,
                'id_range_price' => (int) $rangePrice->id,
                'id_range_weight' => 0,
                'id_zone' => (int) $zone['id_zone'],
                'price' => '0',
            ]);
            if (!$ok) {
                return false;
            }
        }

        return true;
    }

    /**
     * Row-preserving reconfiguration of the existing OL Dynamic carrier for the
     * validateOrder order-create path (ADR-016 / #905). Invoked by the upgrade
     * hook on installs whose carrier predates this change (need_range=0, no
     * groups/ranges).
     *
     * Mutates the existing `ps_carrier` row via direct SQL — deliberately NOT
     * `Carrier::save()`, which PrestaShop duplicates into a new id_carrier and
     * would strand `OPENLINKER_DYNAMIC_CARRIER_ID` plus every historical order
     * referencing the carrier. `setGroups` and the range/delivery rebuild do
     * not touch the carrier row's identity.
     *
     * Idempotent. No-op (success) when the carrier config key is unset.
     *
     * @return bool
     */
    public function upgradeDynamicCarrierForValidateOrder()
    {
        // Register the mail-suppression hook + seed its config default on
        // existing installs (validateOrder import path, #905).
        $this->registerHook('actionEmailSendBefore');
        if (Configuration::get(self::IMPORT_SEND_MAIL_CONFIG_KEY) === false) {
            Configuration::updateValue(self::IMPORT_SEND_MAIL_CONFIG_KEY, 0);
        }

        $carrierId = (int) Configuration::get(self::DYNAMIC_CARRIER_CONFIG_KEY);
        if ($carrierId <= 0) {
            // Fresh install (or carrier missing) — installDynamicCarrier owns it.
            return true;
        }

        Db::getInstance()->execute(
            'UPDATE `' . _DB_PREFIX_ . 'carrier` SET '
            . 'need_range = 1, shipping_method = ' . (int) Carrier::SHIPPING_METHOD_PRICE
            . ' WHERE id_carrier = ' . (int) $carrierId
        );

        $carrier = new Carrier($carrierId);
        if (!Validate::isLoadedObject($carrier)) {
            return false;
        }

        foreach (Zone::getZones(true) as $zone) {
            $carrier->addZone((int) $zone['id_zone']);
        }
        $carrier->setGroups(array_map(
            static function ($group) {
                return (int) $group['id_group'];
            },
            Group::getGroups((int) Configuration::get('PS_LANG_DEFAULT'))
        ));

        return $this->configureDynamicCarrierRanges($carrierId);
    }

    /**
     * Soft-delete the OL Dynamic carrier on uninstall
     *
     * If the carrier is the shop's PS_CARRIER_DEFAULT, reassign to the next
     * active non-OL carrier BEFORE soft-deleting (otherwise checkout points
     * at a deleted=1 carrier and breaks). Pattern from the LP Express module.
     *
     * Soft-delete (deleted=1) preserves order history per the canonical PS
     * pattern — past orders keep referencing the carrier id.
     *
     * @return bool
     */
    private function uninstallDynamicCarrier()
    {
        $carrierId = (int) Configuration::get(self::DYNAMIC_CARRIER_CONFIG_KEY);
        if ($carrierId <= 0) {
            return true;  // nothing to do
        }

        // If our carrier is the shop default, reassign before soft-deleting.
        // Use ALL_CARRIERS rather than the narrower
        // PS_CARRIERS_AND_CARRIER_MODULES_NEED_RANGE filter so we still find
        // a candidate even on shops where every other active carrier is also
        // a need_range=0 module-carrier (rare today, more likely as more
        // OL-style dynamic modules appear). The id-and-module-name guards
        // below already exclude our own carrier from the candidate list.
        if ((int) Configuration::get('PS_CARRIER_DEFAULT') === $carrierId) {
            $carriers = Carrier::getCarriers(
                (int) Configuration::get('PS_LANG_DEFAULT'),
                true,   // active only
                false,
                false,
                null,
                Carrier::ALL_CARRIERS
            );
            foreach ($carriers as $candidate) {
                if (
                    !empty($candidate['active'])
                    && empty($candidate['deleted'])
                    && (int) $candidate['id_carrier'] !== $carrierId
                    && ($candidate['external_module_name'] ?? '') !== $this->name
                ) {
                    Configuration::updateValue(
                        'PS_CARRIER_DEFAULT',
                        (int) $candidate['id_carrier']
                    );
                    break;
                }
            }
        }

        $carrier = new Carrier($carrierId);
        if (Validate::isLoadedObject($carrier)) {
            $carrier->deleted = 1;
            $carrier->update();
        }

        Configuration::deleteByName(self::DYNAMIC_CARRIER_CONFIG_KEY);
        return true;
    }

    /**
     * CarrierModule: PS-called accessor used when ranges are configured.
     *
     * Since ADR-016 / #905 the OL Dynamic carrier ships need_range=1 with a
     * catch-all range (so validateOrder's carrier resolution surfaces it), and
     * PS calls this in-range accessor. Delegating to the external accessor keeps
     * the sidecar amount the single source of truth on every code path.
     *
     * @param Cart $params
     * @param float $shipping_cost
     * @return float|false
     */
    public function getOrderShippingCost($params, $shipping_cost)
    {
        return $this->getOrderShippingCostExternal($params);
    }

    /**
     * CarrierModule: PS-called accessor for external (no-range) shipping.
     *
     * Reads the authoritative tax-incl amount from the sidecar table written
     * by the OpenLinker backend before order-create. Returns false (PS treats
     * as "carrier unavailable") when no sidecar row exists — loud failure
     * surfaces operator misconfig immediately rather than silently shipping
     * at zero.
     *
     * @param Cart $params
     * @return float|false
     */
    public function getOrderShippingCostExternal($params)
    {
        $cartId = (int) (is_object($params) ? $params->id : 0);
        if ($cartId <= 0) {
            return false;
        }

        require_once dirname(__FILE__) . '/classes/CartShippingRepository.php';
        $repo = new CartShippingRepository();
        $row = $repo->findByCartId($cartId);

        if (!$row) {
            PrestaShopLogger::addLog(
                'OpenLinker: no cart-shipping row for id_cart=' . $cartId
                . ' — refusing to ship via OL Dynamic carrier',
                3,  // error
                null, 'Cart', $cartId
            );
            return false;
        }

        return (float) $row['amount_tax_incl'];
    }

    /**
     * Hook: actionCarrierUpdate
     *
     * PS docs: "editing a carrier in BO duplicates the row and assigns a new
     * id_carrier". Without this hook, OPENLINKER_DYNAMIC_CARRIER_ID would go
     * stale on the first BO edit and dynamic-carrier resolution would
     * silently break.
     *
     * @param array $params
     * @return void
     */
    public function hookActionCarrierUpdate($params)
    {
        if (!isset($params['id_carrier'], $params['carrier'])
            || !is_object($params['carrier'])) {
            return;
        }

        $idOld = (int) $params['id_carrier'];
        $idNew = (int) $params['carrier']->id;

        if ($idOld === (int) Configuration::get(self::DYNAMIC_CARRIER_CONFIG_KEY)) {
            Configuration::updateValue(self::DYNAMIC_CARRIER_CONFIG_KEY, $idNew);
        }
    }

    /**
     * Hook: actionEmailSendBefore
     *
     * Returning false cancels the outbound email (PS core: any module returning
     * false short-circuits Mail::Send). We cancel only while the importorder
     * controller is mid-`validateOrder` with mail suppressed (#905) — outside
     * that request-scoped window we return true so normal shop mail is never
     * affected. The cancellation is deliberately coarse (all mail in the window,
     * not template-filtered): the window contains only validateOrder's own
     * order-confirmation/state mails, and template-name matching would couple
     * the module to PS mail-template internals that drift across versions.
     *
     * @param array $params
     * @return bool
     */
    public function hookActionEmailSendBefore($params)
    {
        return self::$suppressImportMail ? false : true;
    }

    /**
     * Set default configuration values
     *
     * @return void
     */
    private function setDefaultConfiguration()
    {
        Configuration::updateValue('OPENLINKER_BASE_URL', '');
        Configuration::updateValue('OPENLINKER_CONNECTION_ID', '');
        Configuration::updateValue('OPENLINKER_WEBHOOK_SECRET', '');
        Configuration::updateValue('OPENLINKER_CRON_TOKEN', $this->generateRandomToken());
        Configuration::updateValue('ENABLE_PRODUCT_EVENTS', 1);
        Configuration::updateValue('ENABLE_STOCK_EVENTS', 1);
        Configuration::updateValue('ENABLE_ORDER_EVENTS', 1);
        Configuration::updateValue('BATCH_SIZE', self::DEFAULT_BATCH_SIZE);
        Configuration::updateValue('MAX_RETRY_ATTEMPTS', self::DEFAULT_MAX_RETRY_ATTEMPTS);
        Configuration::updateValue('RETRY_BACKOFF_MULTIPLIER', self::DEFAULT_RETRY_BACKOFF_MULTIPLIER);
        Configuration::updateValue('DEDUPLICATION_WINDOW_MINUTES', self::DEFAULT_DEDUPLICATION_WINDOW_MINUTES);
        // Default: suppress buyer mail on OL-imported orders (#905).
        Configuration::updateValue(self::IMPORT_SEND_MAIL_CONFIG_KEY, 0);
    }

    /**
     * Clear configuration values
     *
     * @return void
     */
    private function clearConfiguration()
    {
        Configuration::deleteByName('OPENLINKER_BASE_URL');
        Configuration::deleteByName('OPENLINKER_CONNECTION_ID');
        Configuration::deleteByName('OPENLINKER_WEBHOOK_SECRET');
        Configuration::deleteByName('OPENLINKER_CRON_TOKEN');
        Configuration::deleteByName('ENABLE_PRODUCT_EVENTS');
        Configuration::deleteByName('ENABLE_STOCK_EVENTS');
        Configuration::deleteByName('ENABLE_ORDER_EVENTS');
        Configuration::deleteByName('BATCH_SIZE');
        Configuration::deleteByName('MAX_RETRY_ATTEMPTS');
        Configuration::deleteByName('RETRY_BACKOFF_MULTIPLIER');
        Configuration::deleteByName('DEDUPLICATION_WINDOW_MINUTES');
        Configuration::deleteByName(self::IMPORT_SEND_MAIL_CONFIG_KEY);
    }

    /**
     * Install custom tab in main PrestaShop menu
     *
     * Creates a tab in the main menu that links to the module configuration page.
     * The tab will appear in the left sidebar menu for easy access.
     *
     * @return bool Success
     */
    private function installTab()
    {
        // Check if Tab class exists (PrestaShop 1.7+)
        if (!class_exists('Tab')) {
            return true; // Tabs not supported in this PrestaShop version
        }

        // Check if tab already exists
        $tabId = (int)Tab::getIdFromClassName('AdminOpenLinker');
        if ($tabId) {
            // Tab already exists, just activate it
            $tab = new Tab($tabId);
            $tab->active = 1;
            try {
                $tab->save();
            } catch (Exception $e) {
                // Log but continue
                PrestaShopLogger::addLog(
                    'OpenLinker:Error activating existing tab: ' . $e->getMessage(),
                    2,
                    null,
                    'Module',
                    null
                );
            }
            return true;
        }

        // Get parent tab ID (IMPROVE tab - "Improve" section in PrestaShop 1.7+)
        $parentTabId = (int)Tab::getIdFromClassName('IMPROVE');
        if (!$parentTabId) {
            // Fallback to SELL tab if IMPROVE doesn't exist (PrestaShop 1.6)
            $parentTabId = (int)Tab::getIdFromClassName('SELL');
        }
        if (!$parentTabId) {
            // Last fallback: use default parent (usually 0 = root)
            $parentTabId = 0;
        }

        // Create new tab
        $tab = new Tab();
        $tab->active = 1;
        $tab->class_name = 'AdminOpenLinker';
        $tab->name = [];
        
        // Set name for all languages
        foreach (Language::getLanguages(true) as $lang) {
            $tab->name[$lang['id_lang']] = 'OpenLinker';
        }
        
        $tab->id_parent = $parentTabId;
        $tab->module = $this->name;
        
        // Set icon (if available in PrestaShop version)
        if (property_exists($tab, 'icon')) {
            $tab->icon = 'link'; // Use link icon (PrestaShop 1.7+)
        }
        
        // Try to save tab
        try {
            if (!$tab->save()) {
                // If save fails, log but don't fail installation
                $error = Db::getInstance()->getMsgError();
                PrestaShopLogger::addLog(
                    'OpenLinker:Failed to create menu tab: ' . ($error ?: 'Unknown error'),
                    2, // Warning level
                    null,
                    'Module',
                    null
                );
                return true; // Don't fail installation if tab creation fails
            }
            return true;
        } catch (Exception $e) {
            // Log error but don't fail installation
            PrestaShopLogger::addLog(
                'OpenLinker:Error creating menu tab: ' . $e->getMessage(),
                2, // Warning level
                null,
                'Module',
                null
            );
            return true; // Don't fail installation if tab creation fails
        }
    }

    /**
     * Uninstall custom tab from main PrestaShop menu
     *
     * Removes the custom tab when module is uninstalled.
     *
     * @return bool Success
     */
    private function uninstallTab()
    {
        // Check if Tab class exists
        if (!class_exists('Tab')) {
            return true;
        }

        // Find and delete tab
        $tabId = (int)Tab::getIdFromClassName('AdminOpenLinker');
        if ($tabId) {
            $tab = new Tab($tabId);
            try {
                $tab->delete();
            } catch (Exception $e) {
                // Log error but don't fail uninstallation
                PrestaShopLogger::addLog(
                    'OpenLinker:Error deleting menu tab: ' . $e->getMessage(),
                    2, // Warning level
                    null,
                    'Module',
                    null
                );
            }
        }

        return true;
    }

    /**
     * Generate random token for cron endpoint security
     *
     * @return string
     */
    private function generateRandomToken()
    {
        return bin2hex(random_bytes(32));
    }

    /**
     * Hook: Product save/update
     *
     * Captures product creation and update events. Fires after product is persisted.
     * Non-blocking: only enqueues to outbox, no HTTP calls.
     *
     * @param array $params Hook parameters
     * @return void
     */
    public function hookActionProductSave(array $params)
    {
        // Check if product events are enabled
        if (!Configuration::get('ENABLE_PRODUCT_EVENTS')) {
            return;
        }

        // Extract product ID
        $productId = null;
        if (isset($params['id_product'])) {
            $productId = (int)$params['id_product'];
        } elseif (isset($params['product']) && is_object($params['product'])) {
            $productId = (int)$params['product']->id;
        }

        if (!$productId) {
            return;
        }

        // Get connection ID (required for enqueueing)
        $connectionId = Configuration::get('OPENLINKER_CONNECTION_ID');
        if (empty($connectionId)) {
            return; // Module not configured yet
        }

        // Enqueue event (non-blocking, fast write to outbox)
        try {
            // Ensure classes are loaded
            $classesDir = dirname(__FILE__) . '/classes/';
            
            if (!class_exists('EventIdGenerator')) {
                require_once($classesDir . 'EventIdGenerator.php');
            }
            if (!class_exists('OutboxRepository')) {
                require_once($classesDir . 'OutboxRepository.php');
            }

            $repository = new OutboxRepository();
            $repository->enqueueEvent([
                'connectionId' => $connectionId,
                'eventType' => 'product.saved',
                'objectType' => 'product',
                'externalId' => (string)$productId,
                'occurredAt' => date('Y-m-d H:i:s'),
                'payloadJson' => null, // Minimal payload for MVP
            ]);
        } catch (Exception $e) {
            // Log error but don't break the hook (non-fatal)
            PrestaShopLogger::addLog(
                'OpenLinker:Failed to enqueue product event: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString(),
                3, // Error level
                null,
                'Product',
                $productId
            );
        } catch (Throwable $e) {
            // Catch PHP 7+ fatal errors
            PrestaShopLogger::addLog(
                'OpenLinker:Fatal error in product hook: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString(),
                3,
                null,
                'Product',
                $productId
            );
        }
    }

    /**
     * Hook: Order validated/created
     *
     * Captures order creation events. Fires after order is persisted (actionValidateOrderAfter).
     * Non-blocking: only enqueues to outbox, no HTTP calls.
     *
     * @param array $params Hook parameters
     * @return void
     */
    public function hookActionValidateOrderAfter(array $params)
    {
        // Check if order events are enabled
        if (!Configuration::get('ENABLE_ORDER_EVENTS')) {
            return;
        }

        // Extract order ID
        $orderId = null;
        if (isset($params['order']) && is_object($params['order'])) {
            $orderId = (int)$params['order']->id;
        } elseif (isset($params['id_order'])) {
            $orderId = (int)$params['id_order'];
        }

        if (!$orderId) {
            return;
        }

        // Get connection ID
        $connectionId = Configuration::get('OPENLINKER_CONNECTION_ID');
        if (empty($connectionId)) {
            return;
        }

        // Enqueue event
        try {
            // Ensure classes are loaded
            $classesDir = dirname(__FILE__) . '/classes/';
            
            if (!class_exists('EventIdGenerator')) {
                require_once($classesDir . 'EventIdGenerator.php');
            }
            if (!class_exists('OutboxRepository')) {
                require_once($classesDir . 'OutboxRepository.php');
            }

            $repository = new OutboxRepository();
            $repository->enqueueEvent([
                'connectionId' => $connectionId,
                'eventType' => 'order.created',
                'objectType' => 'order',
                'externalId' => (string)$orderId,
                'occurredAt' => date('Y-m-d H:i:s'),
                'payloadJson' => null, // Minimal payload for MVP
            ]);
        } catch (Exception $e) {
            PrestaShopLogger::addLog(
                'OpenLinker:Failed to enqueue order.created event: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString(),
                3,
                null,
                'Order',
                $orderId
            );
        } catch (Throwable $e) {
            PrestaShopLogger::addLog(
                'OpenLinker:Fatal error in order.created hook: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString(),
                3,
                null,
                'Order',
                $orderId
            );
        }
    }

    /**
     * Hook: Order status changed
     *
     * Captures order status change events. Fires after order history is persisted.
     * Non-blocking: only enqueues to outbox, no HTTP calls.
     *
     * @param array $params Hook parameters
     * @return void
     */
    public function hookActionOrderHistoryAddAfter(array $params)
    {
        // Check if order events are enabled
        if (!Configuration::get('ENABLE_ORDER_EVENTS')) {
            return;
        }

        // Extract order ID
        $orderId = null;
        if (isset($params['orderHistory']) && is_object($params['orderHistory'])) {
            $orderId = (int)$params['orderHistory']->id_order;
        } elseif (isset($params['id_order'])) {
            $orderId = (int)$params['id_order'];
        }

        if (!$orderId) {
            return;
        }

        // Extract status IDs if available
        $oldStatusId = null;
        $newStatusId = null;
        if (isset($params['orderHistory']) && is_object($params['orderHistory'])) {
            // Note: PrestaShop doesn't always provide old status in this hook
            // We can only reliably get the new status
            $newStatusId = isset($params['orderHistory']->id_order_state) 
                ? (int)$params['orderHistory']->id_order_state 
                : null;
        }

        // Get connection ID
        $connectionId = Configuration::get('OPENLINKER_CONNECTION_ID');
        if (empty($connectionId)) {
            return;
        }

        // Build minimal payload (optional status IDs)
        $payload = null;
        if ($newStatusId !== null) {
            $payloadData = ['newStatusId' => $newStatusId];
            if ($oldStatusId !== null) {
                $payloadData['oldStatusId'] = $oldStatusId;
            }
            $payload = json_encode($payloadData);
        }

        // Enqueue event
        try {
            // Ensure classes are loaded
            $classesDir = dirname(__FILE__) . '/classes/';
            
            if (!class_exists('EventIdGenerator')) {
                require_once($classesDir . 'EventIdGenerator.php');
            }
            if (!class_exists('OutboxRepository')) {
                require_once($classesDir . 'OutboxRepository.php');
            }

            $repository = new OutboxRepository();
            $repository->enqueueEvent([
                'connectionId' => $connectionId,
                'eventType' => 'order.status_changed',
                'objectType' => 'order',
                'externalId' => (string)$orderId,
                'occurredAt' => date('Y-m-d H:i:s'),
                'payloadJson' => $payload,
            ]);
        } catch (Exception $e) {
            PrestaShopLogger::addLog(
                'OpenLinker:Failed to enqueue order.status_changed event: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString(),
                3,
                null,
                'Order',
                $orderId
            );
        } catch (Throwable $e) {
            PrestaShopLogger::addLog(
                'OpenLinker:Fatal error in order.status_changed hook: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString(),
                3,
                null,
                'Order',
                $orderId
            );
        }
    }

    /**
     * Hook: Stock quantity updated
     *
     * Captures stock change events. Note: Stock hooks are inconsistent across update paths;
     * OpenLinker must also run periodic reconciliation as a safety net.
     * Non-blocking: only enqueues to outbox, no HTTP calls.
     *
     * @param array $params Hook parameters
     * @return void
     */
    public function hookActionUpdateQuantity(array $params)
    {
        // Check if stock events are enabled
        if (!Configuration::get('ENABLE_STOCK_EVENTS')) {
            return;
        }

        // Extract product ID
        $productId = null;
        if (isset($params['id_product'])) {
            $productId = (int)$params['id_product'];
        }

        if (!$productId) {
            return;
        }

        // Extract product attribute ID (may be 0 for product-level stock)
        $productAttributeId = isset($params['id_product_attribute']) 
            ? (int)$params['id_product_attribute'] 
            : 0;

        // Get connection ID
        $connectionId = Configuration::get('OPENLINKER_CONNECTION_ID');
        if (empty($connectionId)) {
            return;
        }

        // Build minimal payload (include product attribute if not 0)
        $payload = null;
        if ($productAttributeId > 0) {
            $payload = json_encode(['id_product_attribute' => $productAttributeId]);
        }

        // Enqueue event
        // Note: Always use product ID as externalId (not product attribute)
        // OpenLinker will handle product attribute variations during sync
        try {
            // Ensure classes are loaded
            $classesDir = dirname(__FILE__) . '/classes/';
            
            if (!class_exists('EventIdGenerator')) {
                require_once($classesDir . 'EventIdGenerator.php');
            }
            if (!class_exists('OutboxRepository')) {
                require_once($classesDir . 'OutboxRepository.php');
            }

            $repository = new OutboxRepository();
            $repository->enqueueEvent([
                'connectionId' => $connectionId,
                'eventType' => 'stock.changed',
                'objectType' => 'stock',
                'externalId' => (string)$productId, // Always product ID
                'occurredAt' => date('Y-m-d H:i:s'),
                'payloadJson' => $payload,
            ]);
        } catch (Exception $e) {
            PrestaShopLogger::addLog(
                'OpenLinker:Failed to enqueue stock.changed event: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString(),
                3,
                null,
                'Product',
                $productId
            );
        } catch (Throwable $e) {
            PrestaShopLogger::addLog(
                'OpenLinker:Fatal error in stock.changed hook: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString(),
                3,
                null,
                'Product',
                $productId
            );
        }
    }
}
