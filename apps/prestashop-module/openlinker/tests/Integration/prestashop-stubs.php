<?php
/**
 * Minimal PrestaShop stubs backed by a real MySQL connection.
 *
 * The outbox defect and its fix live in SQL - a unique index over a nullable
 * column, and which statement releases that column. Neither can be pinned
 * without a real server, so these stubs give OutboxRepository exactly the
 * PrestaShop surface it calls and route it at a throwaway MySQL instance.
 */

if (!defined('_DB_PREFIX_')) {
    define('_DB_PREFIX_', 'ps_');
}

if (!function_exists('pSQL')) {
    function pSQL($value, $htmlOk = false)
    {
        return str_replace(['\\', '"', "'"], ['\\\\', '\\"', "\\'"], (string)$value);
    }
}

if (!function_exists('bqSQL')) {
    function bqSQL($value)
    {
        return str_replace('`', '', (string)$value);
    }
}

class Db
{
    /** @var Db|null */
    private static $instance = null;

    /** @var PDO */
    private $pdo;

    private $lastInsertId = 0;
    private $affectedRows = 0;
    private $lastError = '';

    private function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    public static function boot(PDO $pdo)
    {
        self::$instance = new self($pdo);
    }

    public static function getInstance()
    {
        if (self::$instance === null) {
            throw new RuntimeException('Db::boot() was not called');
        }

        return self::$instance;
    }

    public function pdo()
    {
        return $this->pdo;
    }

    public function execute($sql)
    {
        $this->lastError = '';
        try {
            $statement = $this->pdo->query($sql);
        } catch (PDOException $e) {
            $this->lastError = $e->getMessage();
            return false;
        }

        $this->affectedRows = $statement === false ? 0 : $statement->rowCount();
        // PrestaShop's Insert_ID() mirrors mysqli, which reports 0 when the
        // statement inserted nothing. PDO keeps the previous value instead.
        $this->lastInsertId = $this->affectedRows > 0 ? (int)$this->pdo->lastInsertId() : 0;

        return true;
    }

    public function executeS($sql)
    {
        $this->lastError = '';
        try {
            $statement = $this->pdo->query($sql);
        } catch (PDOException $e) {
            $this->lastError = $e->getMessage();
            return false;
        }

        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    public function getRow($sql)
    {
        $rows = $this->executeS($sql);
        if (empty($rows)) {
            return false;
        }

        return $rows[0];
    }

    public function Insert_ID()
    {
        return $this->lastInsertId;
    }

    public function Affected_Rows()
    {
        return $this->affectedRows;
    }

    public function getMsgError()
    {
        return $this->lastError;
    }
}

class Configuration
{
    private static $values = [];

    public static function set(array $values)
    {
        self::$values = $values;
    }

    public static function get($key)
    {
        return self::$values[$key] ?? false;
    }

    public static function updateValue($key, $value)
    {
        self::$values[$key] = $value;

        return true;
    }
}

class PrestaShopLogger
{
    public static $logs = [];

    public static function addLog($message, $severity = 1, $errorCode = null, $objectType = null, $objectId = null)
    {
        self::$logs[] = ['message' => $message, 'severity' => $severity];
    }
}
