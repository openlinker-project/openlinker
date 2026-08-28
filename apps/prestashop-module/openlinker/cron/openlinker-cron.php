<?php
/**
 * OpenLinker delivery cron entry
 *
 * A cron entry that needs no arguments and no URL (#2618).
 *
 * Several Polish hosts (home.pl, AZ.pl) do not let you write a cron command.
 * You place a PHP file in a directory and its file name selects the schedule,
 * so a documented `curl` line with a token in it is simply unrunnable there.
 * This file is the answer: copy it, rename it to whatever the host's schedule
 * requires, and it runs a delivery pass in-process.
 *
 * Copy it anywhere. It finds the shop by walking up from its own location
 * looking for config/config.inc.php, and honours the OPENLINKER_PS_ROOT
 * environment variable when the copy lives outside the shop tree.
 *
 * Running from the command line needs no credential: reaching the file system
 * already implies more access than the cron token grants. Reached over HTTP it
 * requires the cron token, because the module directory is publicly served.
 *
 * @see classes/DeliveryRunner.php for the pass itself
 */

// PHP_SAPI alone is not enough. Some shared hosts execute .php through a
// suexec wrapper around the CLI binary, and there a genuine HTTP request also
// reports 'cli' - which would run an unauthenticated delivery pass for whoever
// fetched this URL. A real command-line run has no REQUEST_METHOD.
$isCli = (PHP_SAPI === 'cli' || PHP_SAPI === 'phpdbg') && !isset($_SERVER['REQUEST_METHOD']);

$shopRoot = openlinker_find_shop_root(__DIR__);
if ($shopRoot === null) {
    openlinker_fail(
        $isCli,
        'Could not find the PrestaShop installation. Set OPENLINKER_PS_ROOT to the'
        . ' directory that contains config/config.inc.php.'
    );
}

require_once $shopRoot . '/config/config.inc.php';

$moduleDir = _PS_MODULE_DIR_ . 'openlinker/';
require_once $moduleDir . 'classes/CronTokenVerifier.php';
require_once $moduleDir . 'classes/DeliveryRunner.php';

if (!$isCli) {
    // The file sits under a publicly served directory, so an HTTP caller must
    // authenticate exactly as the module's own endpoint requires.
    $presented = CronTokenVerifier::presentedToken($_SERVER, $_POST);
    if (!CronTokenVerifier::matches($presented, (string) Configuration::get('OPENLINKER_CRON_TOKEN'))) {
        http_response_code(403);
        header('Content-Type: text/plain');
        echo "Forbidden. Send the cron token in the X-OpenLinker-Cron-Token header,\n"
            . "or run this file from the command line, where no token is needed.\n";
        exit(1);
    }
}

try {
    $stats = DeliveryRunner::run($isCli ? 'cron file' : 'cron file over http');
} catch (Throwable $e) {
    // Throwable, not Exception: a TypeError raised inside the delivery loop is
    // an Error, and it would otherwise surface as a raw PHP fatal instead of
    // the message below.
    openlinker_fail($isCli, 'Delivery failed: ' . $e->getMessage());
}

// A cron that prints nothing on success is a cron whose mail nobody reads. Over
// HTTP the counters are withheld: the same numbers are on the configuration
// page, and this response goes to whoever holds the cron token.
if ($isCli) {
    echo sprintf(
        "OpenLinker delivery: %d processed, %d delivered, %d failed, %d requeued.\n",
        (int) $stats['processed'],
        (int) $stats['delivered'],
        (int) $stats['failed'],
        (int) $stats['requeued']
    );

    // A pass that stopped on its budget delivered less than the queue held, and
    // the counters above cannot show that on their own (#2652).
    if (!empty($stats['budget_exhausted'])) {
        echo sprintf(
            "OpenLinker delivery: stopped at the %ds run budget, %d event(s) left queued for the next run.\n",
            (int) $stats['budget_seconds'],
            (int) $stats['skipped']
        );
    }
} else {
    header('Content-Type: text/plain');
    echo "OpenLinker delivery pass completed.\n";
}
exit(0);

/**
 * Locate the shop root by walking up from a starting directory.
 *
 * @param string $startDir
 * @return string|null
 */
function openlinker_find_shop_root($startDir)
{
    $fromEnv = getenv('OPENLINKER_PS_ROOT');
    if (is_string($fromEnv) && $fromEnv !== '' && is_file($fromEnv . '/config/config.inc.php')) {
        return rtrim($fromEnv, '/');
    }

    $dir = $startDir;
    // Bounded so a copy placed outside the shop tree fails with a message
    // rather than walking to the file system root.
    for ($depth = 0; $depth < 10; $depth++) {
        if (is_file($dir . '/config/config.inc.php')) {
            return $dir;
        }

        $parent = dirname($dir);
        if ($parent === $dir) {
            return null;
        }
        $dir = $parent;
    }

    return null;
}

/**
 * Report a failure the way the current environment surfaces one, and stop.
 *
 * @param bool   $isCli
 * @param string $message
 * @return void
 */
function openlinker_fail($isCli, $message)
{
    if ($isCli) {
        fwrite(STDERR, 'OpenLinker cron: ' . $message . "\n");
    } else {
        http_response_code(500);
        header('Content-Type: text/plain');
        echo 'OpenLinker cron: ' . $message . "\n";
    }

    // A non-zero exit is what makes a failing cron visible in host panels.
    exit(1);
}
