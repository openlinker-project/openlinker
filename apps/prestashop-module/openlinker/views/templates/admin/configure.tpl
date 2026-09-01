{*
 * OpenLinker Module Configuration Template
 *
 * @author OpenLinker Team
 * @version 1.0.0
 *}

<div class="panel">
    <div class="panel-heading">
        <i class="icon-cog"></i> {l s='OpenLinker Configuration' mod='openlinker'}
    </div>

    <form action="{$form_action|escape:'html':'UTF-8'}" method="post" class="form-horizontal">
        <input type="hidden" name="token" value="{$token|escape:'html':'UTF-8'}" />

        <div class="form-wrapper">
            <h3>{l s='Connection Settings' mod='openlinker'}</h3>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Base URL of your OpenLinker API instance' mod='openlinker'}">
                        {l s='Base URL' mod='openlinker'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="url" name="OPENLINKER_BASE_URL" value="{$base_url|escape:'html':'UTF-8'}" class="form-control" required />
                    <p class="help-block">{l s='Example: http://host.docker.internal:3000 or https://your-openlinker-instance.com' mod='openlinker'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Connection ID from OpenLinker (UUID format)' mod='openlinker'}">
                        {l s='Connection ID' mod='openlinker'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="text" name="OPENLINKER_CONNECTION_ID" value="{$connection_id|escape:'html':'UTF-8'}" class="form-control" required />
                    <p class="help-block">{l s='UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' mod='openlinker'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Shared secret for HMAC signature (must match OpenLinker configuration)' mod='openlinker'}">
                        {l s='Webhook Secret' mod='openlinker'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="password" name="OPENLINKER_WEBHOOK_SECRET" value="" autocomplete="new-password" class="form-control" {if !$webhook_secret_hint}required{/if} />
                    <p class="help-block">
                        {if $webhook_secret_hint}
                            {l s='A secret is saved' mod='openlinker'} ({$webhook_secret_hint|escape:'html':'UTF-8'}{if $webhook_secret_set_at}, {l s='set on' mod='openlinker'} {$webhook_secret_set_at|escape:'html':'UTF-8'}{/if}).
                            {l s='Leave the field empty to keep it. Type a new secret to replace it.' mod='openlinker'}
                        {else}
                            {l s='No secret is saved yet. It must match the one OpenLinker uses for this shop.' mod='openlinker'}
                        {/if}
                    </p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Token to secure the cron endpoint' mod='openlinker'}">
                        {l s='Cron Token' mod='openlinker'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <div class="input-group">
                        <input type="password" name="OPENLINKER_CRON_TOKEN" value="" autocomplete="new-password" class="form-control" />
                        <span class="input-group-btn">
                            <button type="submit" name="regenerate_cron_token" value="1" class="btn btn-default">
                                {l s='Regenerate' mod='openlinker'}
                            </button>
                        </span>
                    </div>
                    <p class="help-block">
                        {if $cron_token_hint}
                            {l s='A token is saved' mod='openlinker'} ({$cron_token_hint|escape:'html':'UTF-8'}{if $cron_token_set_at}, {l s='set on' mod='openlinker'} {$cron_token_set_at|escape:'html':'UTF-8'}{/if}).
                            {l s='Leave the field empty to keep it.' mod='openlinker'}
                        {/if}
                        {l s='The token is never read from the cron URL. Use the cron file shipped with the module, or send the token in the X-OpenLinker-Cron-Token header.' mod='openlinker'}
                    </p>
                </div>
            </div>
        </div>

        <div class="form-wrapper">
            <h3>{l s='Event Types' mod='openlinker'}</h3>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    {l s='Enable Product Events' mod='openlinker'}
                </label>
                <div class="col-lg-9">
                    <span class="switch prestashop-switch fixed-width-lg">
                        <input type="radio" name="ENABLE_PRODUCT_EVENTS" id="ENABLE_PRODUCT_EVENTS_on" value="1" {if $enable_product_events}checked="checked"{/if} />
                        <label for="ENABLE_PRODUCT_EVENTS_on">{l s='Yes' mod='openlinker'}</label>
                        <input type="radio" name="ENABLE_PRODUCT_EVENTS" id="ENABLE_PRODUCT_EVENTS_off" value="0" {if !$enable_product_events}checked="checked"{/if} />
                        <label for="ENABLE_PRODUCT_EVENTS_off">{l s='No' mod='openlinker'}</label>
                        <a class="slide-button btn"></a>
                    </span>
                    <p class="help-block">{l s='Capture product save/update events' mod='openlinker'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    {l s='Enable Stock Events' mod='openlinker'}
                </label>
                <div class="col-lg-9">
                    <span class="switch prestashop-switch fixed-width-lg">
                        <input type="radio" name="ENABLE_STOCK_EVENTS" id="ENABLE_STOCK_EVENTS_on" value="1" {if $enable_stock_events}checked="checked"{/if} />
                        <label for="ENABLE_STOCK_EVENTS_on">{l s='Yes' mod='openlinker'}</label>
                        <input type="radio" name="ENABLE_STOCK_EVENTS" id="ENABLE_STOCK_EVENTS_off" value="0" {if !$enable_stock_events}checked="checked"{/if} />
                        <label for="ENABLE_STOCK_EVENTS_off">{l s='No' mod='openlinker'}</label>
                        <a class="slide-button btn"></a>
                    </span>
                    <p class="help-block">{l s='Capture stock quantity change events' mod='openlinker'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    {l s='Enable Order Events' mod='openlinker'}
                </label>
                <div class="col-lg-9">
                    <span class="switch prestashop-switch fixed-width-lg">
                        <input type="radio" name="ENABLE_ORDER_EVENTS" id="ENABLE_ORDER_EVENTS_on" value="1" {if $enable_order_events}checked="checked"{/if} />
                        <label for="ENABLE_ORDER_EVENTS_on">{l s='Yes' mod='openlinker'}</label>
                        <input type="radio" name="ENABLE_ORDER_EVENTS" id="ENABLE_ORDER_EVENTS_off" value="0" {if !$enable_order_events}checked="checked"{/if} />
                        <label for="ENABLE_ORDER_EVENTS_off">{l s='No' mod='openlinker'}</label>
                        <a class="slide-button btn"></a>
                    </span>
                    <p class="help-block">{l s='Capture order creation and status change events' mod='openlinker'}</p>
                </div>
            </div>
        </div>

        <div class="form-wrapper">
            <h3>{l s='Advanced Settings' mod='openlinker'}</h3>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Number of events to process per cron run' mod='openlinker'}">
                        {l s='Batch Size' mod='openlinker'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="number" name="BATCH_SIZE" value="{$batch_size|escape:'html':'UTF-8'}" class="form-control" min="1" max="200" />
                    <p class="help-block">{l s='Between 1 and 200 (default: 50)' mod='openlinker'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Maximum delivery attempts before marking as failed' mod='openlinker'}">
                        {l s='Max Retry Attempts' mod='openlinker'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="number" name="MAX_RETRY_ATTEMPTS" value="{$max_retry_attempts|escape:'html':'UTF-8'}" class="form-control" min="1" max="100" />
                    <p class="help-block">{l s='Between 1 and 100 (default: 25)' mod='openlinker'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='Exponential backoff multiplier for retry delays' mod='openlinker'}">
                        {l s='Retry Backoff Multiplier' mod='openlinker'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="number" name="RETRY_BACKOFF_MULTIPLIER" value="{$retry_backoff_multiplier|escape:'html':'UTF-8'}" class="form-control" min="1.0" step="0.1" />
                    <p class="help-block">{l s='At least 1.0 (default: 2.0)' mod='openlinker'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='How long delivered events are kept before being deleted' mod='openlinker'}">
                        {l s='Keep Delivered Events (days)' mod='openlinker'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="number" name="OPENLINKER_OUTBOX_RETENTION_DAYS" value="{$outbox_retention_days|escape:'html':'UTF-8'}" class="form-control" min="{$outbox_retention_days_min|intval}" max="{$outbox_retention_days_max|intval}" />
                    <p class="help-block">{l s='Between' mod='openlinker'} {$outbox_retention_days_min|intval} {l s='and' mod='openlinker'} {$outbox_retention_days_max|intval} (default: 7). {l s='Failed events are kept longer as evidence. Events still queued or being retried are never deleted.' mod='openlinker'}</p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='How long one delivery run may take before it stops and leaves the rest for the next run' mod='openlinker'}">
                        {l s='Delivery Run Budget (seconds)' mod='openlinker'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="number" name="OPENLINKER_OUTBOX_RUN_BUDGET_SECONDS" value="{$outbox_run_budget_seconds|intval}" class="form-control" min="{$outbox_run_budget_seconds_min|intval}" max="{$outbox_run_budget_seconds_max|intval}" />
                    <p class="help-block">
                        {l s='Between' mod='openlinker'} {$outbox_run_budget_seconds_min|intval} {l s='and' mod='openlinker'} {$outbox_run_budget_seconds_max|intval} ({l s='default' mod='openlinker'}: {$outbox_run_budget_seconds_default|intval}).
                        {l s='A run stops cleanly once it runs out of time. Events it did not reach stay queued and go out on the next run, so nothing is lost.' mod='openlinker'}
                        {l s='Set it too high and your hosting kills the run instead - shared hosting often stops a PHP process at 300 seconds, and a killed run leaves events stuck until they are recovered. Set it too low and each run sends only a few events, so a backlog drains slowly.' mod='openlinker'}
                    </p>
                </div>
            </div>

            <div class="form-group">
                <label class="control-label col-lg-3">
                    <span class="label-tooltip" data-toggle="tooltip" title="{l s='How long an event may sit half-sent before another run takes it over' mod='openlinker'}">
                        {l s='Recover Stuck Events After (minutes)' mod='openlinker'}
                    </span>
                </label>
                <div class="col-lg-9">
                    <input type="number" name="OPENLINKER_OUTBOX_STALE_MINUTES" value="{$outbox_stale_minutes|intval}" class="form-control" min="{$outbox_stale_minutes_min|intval}" max="{$outbox_stale_minutes_max|intval}" />
                    <p class="help-block">
                        {l s='Between' mod='openlinker'} {$outbox_stale_minutes_min|intval} {l s='and' mod='openlinker'} {$outbox_stale_minutes_max|intval} ({l s='default' mod='openlinker'}: {$outbox_stale_minutes_default|intval}).
                        {l s='If a delivery run is killed by your hosting, the events it had in hand stay stuck until this much time has passed. Then the next run takes them over.' mod='openlinker'}
                        {l s='Set it too high and an outage keeps stalling delivery long after it ends. Set it too low and a run can take over events another run is still sending, and the same event is delivered twice - so the lowest value allowed here follows the run budget above and rises with it.' mod='openlinker'}
                    </p>
                </div>
            </div>
        </div>

        <div class="panel-footer">
            <button type="submit" name="submit{$module_name}" class="btn btn-default pull-right">
                <i class="process-icon-save"></i> {l s='Save' mod='openlinker'}
            </button>
        </div>
    </form>
</div>

<div class="panel">
    <div class="panel-heading">
        <i class="icon-flash"></i> {l s='Actions' mod='openlinker'}
    </div>
    <div class="panel-footer">
        <form action="{$form_action|escape:'html':'UTF-8'}" method="post" style="display: inline-block;">
            <input type="hidden" name="token" value="{$token|escape:'html':'UTF-8'}" />
            <button type="submit" name="testConnection" value="1" class="btn btn-primary">
                <i class="icon-check"></i> {l s='Test Connection' mod='openlinker'}
            </button>
        </form>
        <form action="{$form_action|escape:'html':'UTF-8'}" method="post" style="display: inline-block; margin-left: 10px;">
            <input type="hidden" name="token" value="{$token|escape:'html':'UTF-8'}" />
            <button type="submit" name="runDeliveryNow" value="1" class="btn btn-success">
                <i class="icon-play"></i> {l s='Run Delivery Now' mod='openlinker'}
            </button>
        </form>
    </div>
</div>

<div class="panel">
    <div class="panel-heading">
        <i class="icon-bar-chart"></i> {l s='Statistics' mod='openlinker'}
    </div>
    <div class="form-wrapper">
        <table class="table">
            <tr>
                <td><strong>{l s='Delivery Last Ran' mod='openlinker'}</strong></td>
                <td>
                    {if $delivery_health.ran}
                        {if $delivery_health.stale}<span class="text-danger">{/if}
                        {$delivery_last_run|escape:'html':'UTF-8'}
                        {if $delivery_last_run_source}({$delivery_last_run_source|escape:'html':'UTF-8'}){/if}
                        {if $delivery_health.stale}</span>
                            <span class="help-block text-danger">
                                {l s='No delivery pass has run for over two hours. Events are waiting. Check that the cron is set up and firing.' mod='openlinker'}
                            </span>
                        {/if}
                    {elseif $delivery_health.unreadable}
                        <span class="text-danger">{l s='Unknown' mod='openlinker'}</span>
                        <span class="help-block text-danger">
                            {l s='Delivery has run, but the recorded time cannot be read. Run delivery once with the button above to record a fresh time.' mod='openlinker'}
                        </span>
                    {else}
                        <span class="text-danger">{l s='Never' mod='openlinker'}</span>
                        <span class="help-block text-danger">
                            {l s='Delivery has never run on this shop, so nothing is reaching OpenLinker. Set up the cron described in the module README. If you are upgrading, note that a cron URL carrying &token=... is refused now - use the cron file shipped with the module instead.' mod='openlinker'}
                        </span>
                    {/if}
                </td>
            </tr>
            {if $replay_guard_degraded_at}
            <tr>
                <td><strong>{l s='Replay Protection' mod='openlinker'}</strong></td>
                <td>
                    <span class="text-danger">{l s='Not working' mod='openlinker'}</span>
                    <span class="help-block text-danger">
                        {l s='Signed requests are not being checked for replays, since' mod='openlinker'}
                        {$replay_guard_degraded_at|escape:'html':'UTF-8'}.
                        {if $replay_guard_degraded_error}
                        {l s='The database reported:' mod='openlinker'}
                        <code>{$replay_guard_degraded_error|escape:'html':'UTF-8'}</code>
                        {/if}
                        {l s='The check writes one row per signed request. It can fail because the table was never created (module files copied over an older version instead of upgraded — reset the module from the module list), or because the database refused the write for another reason: the table is full, the disk is full, the connection was lost, or this server is reading a replica. Fix what the message above names.' mod='openlinker'}
                    </span>
                </td>
            </tr>
            {/if}
            <tr>
                <td><strong>{l s='Fast Delivery' mod='openlinker'}</strong></td>
                <td>
                    {if $fast_path_active}
                        <span class="text-success">{l s='Active' mod='openlinker'}</span>
                        <span class="help-block">{l s='Stock and order changes are delivered within seconds on this host.' mod='openlinker'}</span>
                    {else}
                        <span class="text-warning">{l s='Not available on this host' mod='openlinker'}</span>
                        <span class="help-block">{l s='This host does not support the fast delivery path. Stock and order changes are delivered on the next cron run instead - expect the interval configured for the cron trigger, not seconds.' mod='openlinker'}</span>
                    {/if}
                </td>
            </tr>
            <tr>
                <td><strong>{l s='Pending Events' mod='openlinker'}</strong></td>
                <td>{$statistics.pending|intval}</td>
            </tr>
            <tr>
                <td><strong>{l s='Processing Events' mod='openlinker'}</strong></td>
                <td>{$statistics.processing|intval}</td>
            </tr>
            <tr>
                <td><strong>{l s='Failed Events' mod='openlinker'}</strong></td>
                <td>{$statistics.failed|intval}</td>
            </tr>
            <tr>
                <td><strong>{l s='Delivered (Last 24h)' mod='openlinker'}</strong></td>
                <td>{$statistics.delivered_24h|intval}</td>
            </tr>
            {if $statistics.last_delivery}
            <tr>
                <td><strong>{l s='Last Delivery' mod='openlinker'}</strong></td>
                <td>{$statistics.last_delivery|escape:'html':'UTF-8'}</td>
            </tr>
            {/if}
            {if $statistics.last_error}
            <tr>
                <td><strong>{l s='Last Error' mod='openlinker'}</strong></td>
                <td><span class="text-danger">{$statistics.last_error|escape:'html':'UTF-8'}</span></td>
            </tr>
            {/if}
            <tr>
                <td><strong>{l s='Total Rows in Outbox' mod='openlinker'}</strong></td>
                <td>
                    {if $statistics.over_cap}<span class="text-danger">{/if}{$statistics.total|intval}{if $statistics.total_capped}+{/if}{if $statistics.over_cap}</span>{/if}
                    <span class="help-block">
                        {l s='Cap' mod='openlinker'}: {$statistics.max_rows|intval}.
                        {l s='Delivered events are kept' mod='openlinker'} {$statistics.retention_delivered_days|intval} {l s='days, failed events' mod='openlinker'} {$statistics.retention_failed_days|intval} {l s='days.' mod='openlinker'}
                        {if $statistics.over_cap}
                            <strong class="text-danger">{l s='Over the cap. Pruning removes delivered and failed events only, so the excess is undelivered work - check webhook delivery.' mod='openlinker'}</strong>
                        {/if}
                    </span>
                </td>
            </tr>
        </table>
    </div>
</div>
