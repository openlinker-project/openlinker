<?php
/**
 * OpenLinker Admin Controller
 *
 * Admin controller for the OpenLinker module tab in the main menu.
 * Redirects to the module configuration page.
 *
 * This controller provides a custom menu tab that links to the module
 * configuration page, making it easier for administrators to access the
 * module settings from the main PrestaShop menu.
 *
 * @module prestashop-module/controllers
 * @see {@link OpenLinker} for the main module class
 *
 * @author OpenLinker Team
 * @version 1.0.0
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

class AdminOpenLinkerController extends ModuleAdminController
{
    public function __construct()
    {
        $this->bootstrap = true;
        $this->display = 'view';

        parent::__construct();

        // Redirect to module configuration page
        $module = Module::getInstanceByName('openlinker');
        if (Validate::isLoadedObject($module)) {
            // Get module configuration URL
            $moduleLink = $this->context->link->getAdminLink('AdminModules', true) .
                         '&configure=' . $module->name .
                         '&tab_module=' . $module->tab .
                         '&module_name=' . $module->name;

            // Redirect to module configuration
            Tools::redirectAdmin($moduleLink);
        } else {
            // Fallback: show error message
            $this->errors[] = $this->l('OpenLinker module is not installed.');
        }
    }

    /**
     * Render view (fallback if redirect doesn't work)
     */
    public function renderView()
    {
        $module = Module::getInstanceByName('openlinker');
        if (Validate::isLoadedObject($module)) {
            // Get module configuration content
            return $module->getContent();
        }

        return $this->l('OpenLinker module is not installed.');
    }
}
