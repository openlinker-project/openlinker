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
}
