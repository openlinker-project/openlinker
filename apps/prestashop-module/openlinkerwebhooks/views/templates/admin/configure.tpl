ze{*
 * OpenLinker Webhooks Module Configuration Template
 *
 * @author OpenLinker Team
 * @version 1.0.0
 *}

<div class="panel">
    <div class="panel-heading">
        <i class="icon-cog"></i> {l s='OpenLinker Webhooks Configuration' mod='openlinkerwebhooks'}
    </div>

    <form action="{$form_action|escape:'html':'UTF-8'}" method="post" class="form-horizontal">
        <input type="hidden" name="token" value="{$token|escape:'html':'UTF-8'}" />

        <div class="form-wrapper">
            <h3>{l s='Connection Settings' mod='openlinkerwebhooks'}</h3>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Base URL of your OpenLinker API instance' mod='openlinkerwebhooks'}">
                        {l s='Base URL' mod='openlinkerwebhooks'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="url" name="OPENLINKER_BASE_URL" value="{$base_url|escape:'html':'UTF-8'}" class="form-control" required />
                    <p class="help-block">{l s='Example: http://host.docker.internal:3000 or https://your-openlinker-instance.com' mod='openlinkerwebhooks'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Connection ID from OpenLinker (UUID format)' mod='openlinkerwebhooks'}">
                        {l s='Connection ID' mod='openlinkerwebhooks'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="text" name="OPENLINKER_CONNECTION_ID" value="{$connection_id|escape:'html':'UTF-8'}" class="form-control" required />
                    <p class="help-block">{l s='UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' mod='openlinkerwebhooks'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Shared secret for HMAC signature (must match OpenLinker configuration)' mod='openlinkerwebhooks'}">
                        {l s='Webhook Secret' mod='openlinkerwebhooks'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="password" name="OPENLINKER_WEBHOOK_SECRET" value="{$webhook_secret|escape:'html':'UTF-8'}" class="form-control" required />
                    <p class="help-block">{l s='Never share this secret. Must match OpenLinker environment variable.' mod='openlinkerwebhooks'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Token to secure the cron endpoint' mod='openlinkerwebhooks'}">
                        {l s='Cron Token' mod='openlinkerwebhooks'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <div class="input-group">
                        <input type="text" name="OPENLINKER_CRON_TOKEN" value="{$cron_token|escape:'html':'UTF-8'}" class="form-control" />
                        <span class="input-group-btn">
                            <button type="submit" name="regenerate_cron_token" value="1" class="btn btn-default">
                                {l s='Regenerate' mod='openlinkerwebhooks'}
                            </button>
                        </span>
                    </div>
                    <p class="help-block">{l s='Use this token in your cron URL to secure the endpoint' mod='openlinkerwebhooks'}</p>
                </div>
            </div>
        </div>

        <div class="form-wrapper">
            <h3>{l s='Event Types' mod='openlinkerwebhooks'}</h3>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    {l s='Enable Product Events' mod='openlinkerwebhooks'}
                </label>
                <div class="col-lg-9">
                    <span class="switch prestashop-switch fixed-width-lg">
                        <input type="radio" name="ENABLE_PRODUCT_EVENTS" id="ENABLE_PRODUCT_EVENTS_on" value="1" {if $enable_product_events}checked="checked"{/if} />
                        <label for="ENABLE_PRODUCT_EVENTS_on">{l s='Yes' mod='openlinkerwebhooks'}</label>
                        <input type="radio" name="ENABLE_PRODUCT_EVENTS" id="ENABLE_PRODUCT_EVENTS_off" value="0" {if !$enable_product_events}checked="checked"{/if} />
                        <label for="ENABLE_PRODUCT_EVENTS_off">{l s='No' mod='openlinkerwebhooks'}</label>
                        <a class="slide-button btn"></a>
                    </span>
                    <p class="help-block">{l s='Capture product save/update events' mod='openlinkerwebhooks'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    {l s='Enable Stock Events' mod='openlinkerwebhooks'}
                </label>
                <div class="col-lg-9">
                    <span class="switch prestashop-switch fixed-width-lg">
                        <input type="radio" name="ENABLE_STOCK_EVENTS" id="ENABLE_STOCK_EVENTS_on" value="1" {if $enable_stock_events}checked="checked"{/if} />
                        <label for="ENABLE_STOCK_EVENTS_on">{l s='Yes' mod='openlinkerwebhooks'}</label>
                        <input type="radio" name="ENABLE_STOCK_EVENTS" id="ENABLE_STOCK_EVENTS_off" value="0" {if !$enable_stock_events}checked="checked"{/if} />
                        <label for="ENABLE_STOCK_EVENTS_off">{l s='No' mod='openlinkerwebhooks'}</label>
                        <a class="slide-button btn"></a>
                    </span>
                    <p class="help-block">{l s='Capture stock quantity change events' mod='openlinkerwebhooks'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    {l s='Enable Order Events' mod='openlinkerwebhooks'}
                </label>
                <div class="col-lg-9">
                    <span class="switch prestashop-switch fixed-width-lg">
                        <input type="radio" name="ENABLE_ORDER_EVENTS" id="ENABLE_ORDER_EVENTS_on" value="1" {if $enable_order_events}checked="checked"{/if} />
                        <label for="ENABLE_ORDER_EVENTS_on">{l s='Yes' mod='openlinkerwebhooks'}</label>
                        <input type="radio" name="ENABLE_ORDER_EVENTS" id="ENABLE_ORDER_EVENTS_off" value="0" {if !$enable_order_events}checked="checked"{/if} />
                        <label for="ENABLE_ORDER_EVENTS_off">{l s='No' mod='openlinkerwebhooks'}</label>
                        <a class="slide-button btn"></a>
                    </span>
                    <p class="help-block">{l s='Capture order creation and status change events' mod='openlinkerwebhooks'}</p>
                </div>
            </div>
        </div>

        <div class="form-wrapper">
            <h3>{l s='Advanced Settings' mod='openlinkerwebhooks'}</h3>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Number of events to process per cron run' mod='openlinkerwebhooks'}">
                        {l s='Batch Size' mod='openlinkerwebhooks'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="number" name="BATCH_SIZE" value="{$batch_size|escape:'html':'UTF-8'}" class="form-control" min="1" max="200" />
                    <p class="help-block">{l s='Between 1 and 200 (default: 50)' mod='openlinkerwebhooks'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Maximum delivery attempts before marking as failed' mod='openlinkerwebhooks'}">
                        {l s='Max Retry Attempts' mod='openlinkerwebhooks'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="number" name="MAX_RETRY_ATTEMPTS" value="{$max_retry_attempts|escape:'html':'UTF-8'}" class="form-control" min="1" max="100" />
                    <p class="help-block">{l s='Between 1 and 100 (default: 25)' mod='openlinkerwebhooks'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Exponential backoff multiplier for retry delays' mod='openlinkerwebhooks'}">
                        {l s='Retry Backoff Multiplier' mod='openlinkerwebhooks'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="number" name="RETRY_BACKOFF_MULTIPLIER" value="{$retry_backoff_multiplier|escape:'html':'UTF-8'}" class="form-control" min="1.0" step="0.1" />
                    <p class="help-block">{l s='At least 1.0 (default: 2.0)' mod='openlinkerwebhooks'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Time window (in minutes) for event deduplication. Events with the same properties within this window will generate the same event ID, preventing duplicates.' mod='openlinkerwebhooks'}">
                        {l s='Deduplication Window (minutes)' mod='openlinkerwebhooks'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="number" name="DEDUPLICATION_WINDOW_MINUTES" value="{$deduplication_window_minutes|escape:'html':'UTF-8'}" class="form-control" min="1" max="60" />
                    <p class="help-block">{l s='Between 1 and 60 minutes (default: 1). Prevents duplicate events when hooks fire multiple times rapidly.' mod='openlinkerwebhooks'}</p>
                </div>
            </div>
        </div>

        <div class="panel-footer">
            <button type="submit" name="submit{$module_name}" class="btn btn-default pull-right">
                <i class="process-icon-save"></i> {l s='Save' mod='openlinkerwebhooks'}
            </button>
        </div>
    </form>
</div>

<div class="panel">
    <div class="panel-heading">
        <i class="icon-flash"></i> {l s='Actions' mod='openlinkerwebhooks'}
    </div>
    <div class="panel-footer">
        <form action="{$form_action|escape:'html':'UTF-8'}" method="post" style="display: inline-block;">
            <input type="hidden" name="token" value="{$token|escape:'html':'UTF-8'}" />
            <button type="submit" name="testConnection" value="1" class="btn btn-primary">
                <i class="icon-check"></i> {l s='Test Connection' mod='openlinkerwebhooks'}
            </button>
        </form>
        <form action="{$form_action|escape:'html':'UTF-8'}" method="post" style="display: inline-block; margin-left: 10px;">
            <input type="hidden" name="token" value="{$token|escape:'html':'UTF-8'}" />
            <button type="submit" name="runDeliveryNow" value="1" class="btn btn-success">
                <i class="icon-play"></i> {l s='Run Delivery Now' mod='openlinkerwebhooks'}
            </button>
        </form>
    </div>
</div>

<div class="panel">
    <div class="panel-heading">
        <i class="icon-bar-chart"></i> {l s='Statistics' mod='openlinkerwebhooks'}
    </div>
    <div class="form-wrapper">
        <table class="table">
            <tr>
                <td><strong>{l s='Pending Events' mod='openlinkerwebhooks'}</strong></td>
                <td>{$statistics.pending|intval}</td>
            </tr>
            <tr>
                <td><strong>{l s='Processing Events' mod='openlinkerwebhooks'}</strong></td>
                <td>{$statistics.processing|intval}</td>
            </tr>
            <tr>
                <td><strong>{l s='Failed Events' mod='openlinkerwebhooks'}</strong></td>
                <td>{$statistics.failed|intval}</td>
            </tr>
            <tr>
                <td><strong>{l s='Delivered (Last 24h)' mod='openlinkerwebhooks'}</strong></td>
                <td>{$statistics.delivered_24h|intval}</td>
            </tr>
            {if $statistics.last_delivery}
            <tr>
                <td><strong>{l s='Last Delivery' mod='openlinkerwebhooks'}</strong></td>
                <td>{$statistics.last_delivery|escape:'html':'UTF-8'}</td>
            </tr>
            {/if}
            {if $statistics.last_error}
            <tr>
                <td><strong>{l s='Last Error' mod='openlinkerwebhooks'}</strong></td>
                <td><span class="text-danger">{$statistics.last_error|escape:'html':'UTF-8'}</span></td>
            </tr>
            {/if}
        </table>
    </div>
</div>
