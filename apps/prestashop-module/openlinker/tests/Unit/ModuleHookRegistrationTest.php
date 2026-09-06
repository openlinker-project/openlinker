<?php

use PHPUnit\Framework\TestCase;

/**
 * Hook registration invariants for openlinker.php.
 *
 * The module file cannot be loaded here - it extends PrestaShop's Module and
 * pulls half the framework with it - so these read the source. That is enough
 * for the two mistakes that are silent at runtime: a hook registered on install
 * but never unregistered, and a hook registered with no handler method, which
 * PrestaShop calls and quietly does nothing with.
 */
class ModuleHookRegistrationTest extends TestCase
{
    /** @var string */
    private static $source;

    public static function setUpBeforeClass(): void
    {
        self::$source = file_get_contents(dirname(__DIR__, 2) . '/openlinker.php');
    }

    /**
     * @return string[][] one entry per `$hooks = [...]` literal in the file
     */
    private function hookLists(): array
    {
        preg_match_all('/\$hooks = \[(.*?)\];/s', self::$source, $matches);

        $lists = [];
        foreach ($matches[1] as $block) {
            preg_match_all("/'([A-Za-z]+)'/", $block, $names);
            $lists[] = $names[1];
        }

        return $lists;
    }

    public function testInstallAndUninstallRegisterTheSameHooks(): void
    {
        $lists = $this->hookLists();

        self::assertCount(2, $lists, 'expected exactly the install and uninstall hook lists');
        self::assertSame($lists[0], $lists[1], 'install and uninstall hook lists diverged');
    }

    public function testProductDeleteHookIsRegistered(): void
    {
        foreach ($this->hookLists() as $list) {
            self::assertContains('actionProductDelete', $list);
        }
    }

    public function testEveryRegisteredHookHasAHandler(): void
    {
        foreach ($this->hookLists()[0] as $hook) {
            self::assertStringContainsString(
                'public function hook' . ucfirst($hook) . '(',
                self::$source,
                'hook ' . $hook . ' is registered but has no handler method'
            );
        }
    }

    public function testProductDeleteHandlerEnqueuesADeletionEvent(): void
    {
        $start = strpos(self::$source, 'public function hookActionProductDelete(');
        self::assertNotFalse($start);

        $body = substr(self::$source, $start, 4000);

        self::assertStringContainsString("'eventType' => 'product.deleted'", $body);
        self::assertStringContainsString("'objectType' => 'product'", $body);
        // The subject is the PrestaShop product id; OpenLinker resolves it to an
        // internal id through the existing identifier mapping.
        self::assertStringContainsString("'externalId' => (string)\$productId", $body);
    }

    /**
     * #2924: `actionUpdateQuantity` (PrestaShop's static
     * `StockAvailable::setQuantity()`, the module's only stock hook before
     * this) never fires for a webservice write to a SIMPLE product's own
     * stock_availables row - `StockAvailableCore::postSave()` returns
     * immediately for that row shape on both PrestaShop 8.x and 9.x, so
     * `setQuantity()` (and the hook) never runs. The two generic
     * `ObjectModel` hooks below fire unconditionally on every
     * `StockAvailable::add()`/`update()` - including the webservice's own
     * `updateWs()` - so they must be registered ALONGSIDE
     * `actionUpdateQuantity`, not instead of it, or the module regresses to
     * covering only the paths that already worked.
     */
    public function testStockCoverageHooksAreRegisteredAlongsideActionUpdateQuantity(): void
    {
        foreach ($this->hookLists() as $list) {
            self::assertContains('actionUpdateQuantity', $list);
            self::assertContains('actionObjectStockAvailableUpdateAfter', $list);
            self::assertContains('actionObjectStockAvailableAddAfter', $list);
        }
    }

    /**
     * The generic hooks are handed the just-saved `StockAvailable` instance
     * as `$params['object']` (PrestaShop's own `Hook::exec('actionObject' .
     * $this->getFullyQualifiedName() . 'UpdateAfter', ['object' => $this])`
     * convention) - never `id_product`/`id_product_attribute` directly the
     * way `actionUpdateQuantity`'s params carry them. A handler written
     * against the wrong shape would silently enqueue nothing for every
     * webservice write, which is exactly the defect this pair exists to fix.
     */
    public function testGenericStockHooksReadTheSavedObjectShape(): void
    {
        foreach (['UpdateAfter', 'AddAfter'] as $suffix) {
            $needle = 'public function hookActionObjectStockAvailable' . $suffix . '(';
            $start = strpos(self::$source, $needle);
            self::assertNotFalse($start, $needle . ' not found');

            $body = substr(self::$source, $start, 400);
            self::assertStringContainsString('enqueueStockChangedEventFromObject($params)', $body);
        }

        $helperStart = strpos(self::$source, 'private function enqueueStockChangedEventFromObject(');
        self::assertNotFalse($helperStart);
        $helperBody = substr(self::$source, $helperStart, 800);

        self::assertStringContainsString('instanceof StockAvailable', $helperBody);
        self::assertStringContainsString('$object->id_product', $helperBody);
        self::assertStringContainsString('$object->id_product_attribute', $helperBody);
    }

    /**
     * Both stock hooks must produce the SAME outbox event shape
     * (`stock.changed` / `stock` / product id as external id) - a caller
     * cannot tell from the outbox row which hook produced it, and OpenLinker
     * must not need to.
     */
    public function testBothStockHooksShareOneEnqueueShape(): void
    {
        $start = strpos(self::$source, 'private function enqueueStockChangedEvent(');
        self::assertNotFalse($start);

        $body = substr(self::$source, $start, 3000);

        self::assertStringContainsString("'eventType' => 'stock.changed'", $body);
        self::assertStringContainsString("'objectType' => 'stock'", $body);
        self::assertStringContainsString("'externalId' => (string)\$productId", $body);
    }
}
