<?php
/**
 * OpenLinker PrestaShop Module
 *
 * Host module for OpenLinker capabilities on PrestaShop. Currently provides
 * the webhook outbox capability: emits secure webhook events to OpenLinker to
 * support event-driven sync triggers ("trigger pull"). Captures PrestaShop
 * events via hooks, writes to a durable outbox table, and delivers via HTTP
 * POST with HMAC signature and retry/backoff. Additional capabilities (e.g.
 * dynamic shipping carrier) live alongside this one in the same module.
 *
 * This module implements the outbox pattern for reliable event delivery:
 * - Hooks write events to a durable outbox table (non-blocking)
 * - Cron job or manual delivery processes events with retry/backoff
 * - Events are idempotent and safe to retry
 *
 * @module prestashop-module
 * @see {@link OutboxRepository} for outbox persistence and state management
 * @see {@link WebhookSender} for HTTP delivery with HMAC signatures
 * @see {@link EventIdGenerator} for deterministic event ID generation
 *
 * @author OpenLinker Team
 * @version 1.0.0
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
class OpenLinker extends Module
{
    // Configuration defaults
    const DEFAULT_BATCH_SIZE = 50;
    const DEFAULT_MAX_RETRY_ATTEMPTS = 25;
    const DEFAULT_RETRY_BACKOFF_MULTIPLIER = 2.0;
    const DEFAULT_DEDUPLICATION_WINDOW_MINUTES = 1;

    public function __construct()
    {
        $this->name = 'openlinker';
        $this->tab = 'administration';
        $this->version = '1.0.0';
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
        // Register hooks
        $hooks = [
            'actionProductSave',
            'actionValidateOrderAfter',
            'actionOrderHistoryAddAfter',
            'actionUpdateQuantity',
        ];

        if (!parent::install()) {
            return false;
        }

        foreach ($hooks as $hook) {
            if (!$this->registerHook($hook)) {
                return false;
            }
        }

        // Create outbox table
        if (!$this->createOutboxTable()) {
            return false;
        }

        // Set default configuration
        $this->setDefaultConfiguration();

        // Install custom tab in main menu
        if (!$this->installTab()) {
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
        ];

        foreach ($hooks as $hook) {
            $this->unregisterHook($hook);
        }

        // Clear configuration
        $this->clearConfiguration();

        // Remove custom tab from main menu
        $this->uninstallTab();

        // Optionally drop outbox table (or keep for audit)
        // Uncomment if you want to drop the table on uninstall:
        // $this->dropOutboxTable();

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
