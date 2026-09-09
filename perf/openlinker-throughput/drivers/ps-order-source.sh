#!/usr/bin/env bash
#
# F11 driver library (#2979, epic #2840) - PrestaShop-as-order-SOURCE
# primitives, for the second channel of the concurrent multi-channel scenario.
#
# Sourced by scenarios/f11-concurrent-multichannel.sh, never run standalone.
# Requires lib.sh already sourced (ps_sql/ps_sql_write/log/warn/die).
#
# ---------------------------------------------------------------------------
# WHY THIS EXISTS, AND WHY IT IS NOT ORDER-FEED.SH POINTED AT A SECOND STUB
# ---------------------------------------------------------------------------
# Every prior order-arrival driver on this stand (order-feed.sh for Allegro,
# make-8line-order.sh / run-a4-ingest.sh for PrestaShop) pushes an order into
# something OL reads FROM one direction only: a stub marketplace, or OL's own
# order_records as the DESTINATION side of a create. None of them makes
# PrestaShop itself the SOURCE - a genuine native order sitting in ps_orders
# that OL's PrestashopOrderSourceAdapter discovers on its own, the same way a
# real customer's checkout would produce one.
#
# #2979 needs a second real PLATFORM channel, not a second Allegro tenant (see
# the F11 scenario's own header for why two same-platform connections would
# answer a narrower question). PrestaShop is the only second OrderSourcePort
# implementer already provisioned on this stand with a working webservice key
# and real seeded catalogue (WooCommerce's catalogue is not yet seeded,
# #3024/#3025 in flight; Erli has no stub and its base-URL policy refuses one,
# #2865 decision doc) - so PrestaShop-as-source is the only channel-2 that
# does not require new infrastructure this issue would have to build first.
#
# ---------------------------------------------------------------------------
# WEBSERVICE, NOT RAW SQL, NOT A BROWSER CHECKOUT
# ---------------------------------------------------------------------------
# Three ways exist to make a native order appear in PrestaShop. Raw INSERT
# into ps_orders/ps_order_detail/ps_customer/ps_address/ps_cart is the
# lowest-level and the riskiest: a subtly wrong row shape either fails
# silently (an order OL's adapter cannot parse, which reads as "ingestion
# broken" when the fault is the seed) or writes something structurally
# invalid into a shop OTHER scenarios' guards also read from (ps_orders
# COUNT is ground truth for run-a4-ingest.sh and f10-dependency-failure.sh).
# A full browser-driven checkout (cart -> address -> carrier -> payment
# module -> validateOrder) is the most realistic but needs Selenium/Playwright
# machinery this repo's perf stand does not carry anywhere.
#
# The webservice sits between the two: it is PrestaShop's own supported write
# API (customer -> address -> cart -> order, bootstrap.sh already grants full
# CRUD on every resource this needs - "orders order_details customers
# addresses countries currencies carts ... carriers order_carriers
# order_states"), and unlike a raw INSERT a malformed request comes back as
# an explicit 400 naming the missing/invalid field rather than a row that
# quietly fails to parse. It is also the same shape OpenLinker's own
# `PrestashopOrderProcessorAdapter` docblock warns AGAINST for OL's outbound
# writes ("bypasses validateOrder and drops the carrier" - #503/#898) - but
# that warning is about FIDELITY to what a specific-priced OL order must
# reproduce exactly. Here the order is native to begin with; the webservice
# write IS the "real" order, the same way an admin creating an order by hand
# in the back office is real.
#
# ---------------------------------------------------------------------------
# WHY THE REQUIRED-FIELD LIST BELOW IS AN EDUCATED STARTING POINT, NOT A
# VERIFIED ONE - AND WHAT TO DO WHEN IT IS WRONG
# ---------------------------------------------------------------------------
# PrestaShop's webservice does not recompute an Order's totals server-side the
# way checkout's PaymentModule::validateOrder does - it persists what it is
# given. Getting a numeric field wrong (a missing total_* column, a stale
# reference to a deleted carrier) does not corrupt anything: PrestaShop's
# webservice validates required fields before writing and answers a 400
# naming the field. `pso_push_orders` is written to surface that response
# body verbatim rather than swallow it, specifically so the ONE validation
# call #2979's process asks for produces an actionable error rather than a
# silent failure - this has NOT been exercised against a live shop, and the
# field list is expected to need at least one iteration.
#
set -euo pipefail

# The shop's own base URL as seen from the HOST (curl runs here, same
# host-vs-network-namespace split as order-feed.sh's OF_STUB_URL) - port
# 19080, docker-compose.lab.yml's PRESTASHOP_HOST_PORT default.
PSO_BASE_URL="${PSO_BASE_URL:-http://127.0.0.1:19080}"
PSO_WS_KEY="${PSO_WS_KEY:-${PS_WS_KEY:-}}"

# The cursor key PrestaShop's OrderSourcePort uses for its date_upd-watermark
# reconciliation poll (`prestashop-orders-poll` task /
# prestashop-order-source.adapter.ts). Restated, not invented, for the same
# reason order-feed.sh restates OF_CURSOR_KEY: a driver that guessed at this
# would silently measure a cursor the adapter never reads.
PSO_CURSOR_KEY="${PSO_CURSOR_KEY:-prestashop.orders.dateUpd}"

# ---------------------------------------------------------------------------
# pso_ws_curl <method> <path-with-query> [xml-body]
#
# POST/PUT bodies are XML - PrestaShop's webservice does not accept a JSON
# request body on a write, only `Output-Format: JSON` on the RESPONSE of a
# GET (verified against this repo's own webservice client,
# prestashop-webservice.client.ts:380/573-576, which sends
# `Content-Type: application/xml` on every write and only asks for
# `Output-Format: JSON` on GET). Dies on a non-2xx with the body printed -
# PrestaShop's validation errors are the whole point of using the webservice
# over raw SQL, so swallowing them here would throw away the one advantage.
# ---------------------------------------------------------------------------
pso_ws_curl() {
  local method="$1" path="$2" body="${3:-}" sep resp status resp_body
  [ -n "$PSO_WS_KEY" ] || die "pso_ws_curl: PSO_WS_KEY is not set - export PS_WS_KEY from stand-ids.env"
  case "$path" in *\?*) sep='&' ;; *) sep='?' ;; esac
  if [ -n "$body" ]; then
    resp="$(curl -sS -w '\n%{http_code}' -X "$method" \
      "$PSO_BASE_URL$path${sep}ws_key=$PSO_WS_KEY&output_format=JSON" \
      -H 'Content-Type: application/xml' -d "$body")"
  else
    resp="$(curl -sS -w '\n%{http_code}' -X "$method" \
      "$PSO_BASE_URL$path${sep}ws_key=$PSO_WS_KEY&output_format=JSON")"
  fi
  status="$(printf '%s' "$resp" | tail -n1)"
  resp_body="$(printf '%s' "$resp" | sed '$d')"
  case "$status" in
    2*) printf '%s' "$resp_body" ;;
    *) die "pso_ws_curl: $method $path -> HTTP $status
$resp_body" ;;
  esac
}

# ---------------------------------------------------------------------------
# pso_resolve_refs - reads the reference ids this channel needs off the LIVE
# shop, once per scenario run, and exports them as PSO_* globals. Every read
# is a plain SELECT against ps_sql (read-only, no guard_stand_exclusive
# needed for a read alone - only the WRITES this file makes are stand
# mutations).
#
# Refuses (via `die`) rather than guessing when a reference is absent: an
# invented carrier/currency/state id would either 400 at the webservice (the
# same failure surfaced later and more confusingly) or - worse - silently
# resolve to SOME other row on a shop whose ids happen to collide.
# ---------------------------------------------------------------------------
pso_resolve_refs() {
  PSO_CURRENCY_ID="$(as_count "$(ps_sql "SELECT id_currency FROM ps_currency WHERE active=1 ORDER BY id_currency LIMIT 1" 2>/dev/null | tr -d '[:space:]')")"
  [ -n "$PSO_CURRENCY_ID" ] || die "pso_resolve_refs: no active currency on the shop"

  PSO_COUNTRY_ID="$(as_count "$(ps_sql "SELECT id_country FROM ps_country WHERE iso_code='PL' LIMIT 1" 2>/dev/null | tr -d '[:space:]')")"
  [ -n "$PSO_COUNTRY_ID" ] || PSO_COUNTRY_ID="$(as_count "$(ps_sql "SELECT id_country FROM ps_country WHERE active=1 ORDER BY id_country LIMIT 1" 2>/dev/null | tr -d '[:space:]')")"
  [ -n "$PSO_COUNTRY_ID" ] || die "pso_resolve_refs: no usable country on the shop"

  PSO_CARRIER_ID="$(as_count "$(ps_sql "SELECT id_carrier FROM ps_carrier WHERE deleted=0 AND active=1 ORDER BY id_carrier LIMIT 1" 2>/dev/null | tr -d '[:space:]')")"
  [ -n "$PSO_CARRIER_ID" ] || die "pso_resolve_refs: no active, non-deleted carrier on the shop"

  # A paid state (paid=1) so the order round-trips through the
  # PrestashopOrderSourceAdapter's cancelled-detection read as a live order
  # (prestashop-order-source.adapter.ts:500, statusOf on current_state), not
  # as something OL might read as already-terminal.
  PSO_ORDER_STATE_ID="$(as_count "$(ps_sql "SELECT id_order_state FROM ps_order_state WHERE paid=1 ORDER BY id_order_state LIMIT 1" 2>/dev/null | tr -d '[:space:]')")"
  [ -n "$PSO_ORDER_STATE_ID" ] || die "pso_resolve_refs: no paid=1 order state on the shop"

  # The seeded PERFBASE catalogue (seed-catalogue.sh), the same population
  # make-8line-order.sh draws from - already tax-grouped by bootstrap.sh's
  # step_tax_group, so its price/tax fields are internally consistent.
  PSO_PRODUCT_ID="$(as_count "$(ps_sql "SELECT id_product FROM ps_product WHERE reference LIKE 'PERFBASE-%' AND active=1 ORDER BY id_product LIMIT 1" 2>/dev/null | tr -d '[:space:]')")"
  [ -n "$PSO_PRODUCT_ID" ] || die "pso_resolve_refs: no active PERFBASE product on the shop - run seed-catalogue.sh first"
  PSO_PRODUCT_PRICE="$(ps_sql "SELECT price FROM ps_product WHERE id_product=$PSO_PRODUCT_ID" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$PSO_PRODUCT_PRICE" ] || die "pso_resolve_refs: product $PSO_PRODUCT_ID has no price"
  # 0 = the simple-product convention for a cart row with no combination.
  PSO_PRODUCT_ATTR_ID="$(as_count "$(ps_sql "SELECT id_product_attribute FROM ps_product_attribute WHERE id_product=$PSO_PRODUCT_ID ORDER BY id_product_attribute LIMIT 1" 2>/dev/null | tr -d '[:space:]')")"
  [ -n "$PSO_PRODUCT_ATTR_ID" ] || PSO_PRODUCT_ATTR_ID=0

  log "pso_resolve_refs: currency=$PSO_CURRENCY_ID country=$PSO_COUNTRY_ID carrier=$PSO_CARRIER_ID state=$PSO_ORDER_STATE_ID product=$PSO_PRODUCT_ID(attr=$PSO_PRODUCT_ATTR_ID, price=$PSO_PRODUCT_PRICE)"
}

# ---------------------------------------------------------------------------
# pso_ensure_customer <tag> - get-or-create ONE reusable customer+address for
# this channel, mirroring make-8line-order.sh's "reuse the customer of an
# order that already synced" reasoning: fewer moving parts pushing N orders
# than minting N customers, and it is the customer/address pair, not the
# order, whose identity this channel needs to be stable across the run.
#
# Idempotent by email: a re-run of the scenario against a stand that already
# has this channel's customer reuses it rather than accumulating duplicates
# (bootstrap.sh's own found/created convention).
# ---------------------------------------------------------------------------
pso_ensure_customer() {
  local tag="${1:-f11}" email="perf-source-${1:-f11}@example.invalid" existing
  existing="$(as_count "$(ps_sql "SELECT id_customer FROM ps_customer WHERE email='$email' LIMIT 1" 2>/dev/null | tr -d '[:space:]')")"
  if [ -n "$existing" ]; then
    PSO_CUSTOMER_ID="$existing"
  else
    local resp
    resp="$(pso_ws_curl POST '/api/customers' "<prestashop xmlns=\"http://www.prestashop.com/xml/xsd\">
  <customer>
    <passwd>Perf-Source-1234</passwd>
    <lastname>Source</lastname>
    <firstname>Perf${tag^}</firstname>
    <email>${email}</email>
    <active>1</active>
    <newsletter>0</newsletter>
    <optin>0</optin>
  </customer>
</prestashop>")"
    PSO_CUSTOMER_ID="$(printf '%s' "$resp" | jq -r '.customer.id // empty')"
    [ -n "$PSO_CUSTOMER_ID" ] || die "pso_ensure_customer: create returned no id. Response: $resp"
  fi

  existing="$(as_count "$(ps_sql "SELECT id_address FROM ps_address WHERE id_customer=$PSO_CUSTOMER_ID AND deleted=0 LIMIT 1" 2>/dev/null | tr -d '[:space:]')")"
  if [ -n "$existing" ]; then
    PSO_ADDRESS_ID="$existing"
  else
    local resp
    resp="$(pso_ws_curl POST '/api/addresses' "<prestashop xmlns=\"http://www.prestashop.com/xml/xsd\">
  <address>
    <id_customer>${PSO_CUSTOMER_ID}</id_customer>
    <id_country>${PSO_COUNTRY_ID}</id_country>
    <alias>perf-source-${tag}</alias>
    <lastname>Source</lastname>
    <firstname>Perf${tag^}</firstname>
    <address1>1 Perf Source Street</address1>
    <city>Warsaw</city>
    <postcode>00-001</postcode>
  </address>
</prestashop>")"
    PSO_ADDRESS_ID="$(printf '%s' "$resp" | jq -r '.address.id // empty')"
    [ -n "$PSO_ADDRESS_ID" ] || die "pso_ensure_customer: address create returned no id. Response: $resp"
  fi
  log "pso_ensure_customer: customer=$PSO_CUSTOMER_ID address=$PSO_ADDRESS_ID"
}

# ---------------------------------------------------------------------------
# pso_push_one_order - creates ONE cart, then ONE order against it, and
# echoes the new order's id_order. A fresh cart per order (rather than one
# shared cart) because PrestaShop's own admin UI treats a cart as
# order-scoped once validated; sharing one across N webservice orders is an
# untested shape this driver has no reason to reach for when a fresh cart
# costs one extra request.
#
# `total_products` / `total_paid*` are a computed APPROXIMATION
# (price x quantity, x1.23 for the tax-inclusive figures) rather than a true
# tax computation - deliberate, since this channel exists to exercise
# OL's INGESTION read path, not to reproduce PrestaShop's own tax engine.
# See the file header for what to do if the webservice rejects these.
# ---------------------------------------------------------------------------
pso_push_one_order() {
  local reference_tag="${1:-f11}" resp cart_id order_id total_excl total_incl
  resp="$(pso_ws_curl POST '/api/carts' "<prestashop xmlns=\"http://www.prestashop.com/xml/xsd\">
  <cart>
    <id_currency>${PSO_CURRENCY_ID}</id_currency>
    <id_lang>1</id_lang>
    <id_address_delivery>${PSO_ADDRESS_ID}</id_address_delivery>
    <id_address_invoice>${PSO_ADDRESS_ID}</id_address_invoice>
    <id_customer>${PSO_CUSTOMER_ID}</id_customer>
    <id_carrier>${PSO_CARRIER_ID}</id_carrier>
    <recyclable>0</recyclable>
    <gift>0</gift>
    <associations>
      <cart_rows>
        <cart_row>
          <id_product>${PSO_PRODUCT_ID}</id_product>
          <id_product_attribute>${PSO_PRODUCT_ATTR_ID}</id_product_attribute>
          <id_address_delivery>${PSO_ADDRESS_ID}</id_address_delivery>
          <quantity>1</quantity>
        </cart_row>
      </cart_rows>
    </associations>
  </cart>
</prestashop>")"
  cart_id="$(printf '%s' "$resp" | jq -r '.cart.id // empty')"
  [ -n "$cart_id" ] || die "pso_push_one_order: cart create returned no id. Response: $resp"

  total_excl="$PSO_PRODUCT_PRICE"
  total_incl="$(awk -v p="$PSO_PRODUCT_PRICE" 'BEGIN{printf "%.2f", p*1.23}')"

  resp="$(pso_ws_curl POST '/api/orders' "<prestashop xmlns=\"http://www.prestashop.com/xml/xsd\">
  <order>
    <id_address_delivery>${PSO_ADDRESS_ID}</id_address_delivery>
    <id_address_invoice>${PSO_ADDRESS_ID}</id_address_invoice>
    <id_cart>${cart_id}</id_cart>
    <id_currency>${PSO_CURRENCY_ID}</id_currency>
    <id_lang>1</id_lang>
    <id_customer>${PSO_CUSTOMER_ID}</id_customer>
    <id_carrier>${PSO_CARRIER_ID}</id_carrier>
    <current_state>${PSO_ORDER_STATE_ID}</current_state>
    <module>ps_wirepayment</module>
    <invoice_number>0</invoice_number>
    <delivery_number>0</delivery_number>
    <valid>1</valid>
    <payment>Bank wire (perf source)</payment>
    <recyclable>0</recyclable>
    <gift>0</gift>
    <total_discounts>0</total_discounts>
    <total_discounts_tax_incl>0</total_discounts_tax_incl>
    <total_discounts_tax_excl>0</total_discounts_tax_excl>
    <total_paid>${total_incl}</total_paid>
    <total_paid_tax_incl>${total_incl}</total_paid_tax_incl>
    <total_paid_tax_excl>${total_excl}</total_paid_tax_excl>
    <total_paid_real>${total_incl}</total_paid_real>
    <total_products>${total_excl}</total_products>
    <total_products_wt>${total_incl}</total_products_wt>
    <total_shipping>0</total_shipping>
    <total_shipping_tax_incl>0</total_shipping_tax_incl>
    <total_shipping_tax_excl>0</total_shipping_tax_excl>
    <carrier_tax_rate>0</carrier_tax_rate>
    <total_wrapping>0</total_wrapping>
    <total_wrapping_tax_incl>0</total_wrapping_tax_incl>
    <total_wrapping_tax_excl>0</total_wrapping_tax_excl>
    <round_mode>0</round_mode>
    <round_type>0</round_type>
    <conversion_rate>1</conversion_rate>
    <associations>
      <order_rows>
        <order_row>
          <product_id>${PSO_PRODUCT_ID}</product_id>
          <product_attribute_id>${PSO_PRODUCT_ATTR_ID}</product_attribute_id>
          <product_quantity>1</product_quantity>
          <product_price>${total_excl}</product_price>
          <unit_price_tax_incl>${total_incl}</unit_price_tax_incl>
          <unit_price_tax_excl>${total_excl}</unit_price_tax_excl>
        </order_row>
      </order_rows>
    </associations>
  </order>
</prestashop>")"
  order_id="$(printf '%s' "$resp" | jq -r '.order.id // empty')"
  [ -n "$order_id" ] || die "pso_push_one_order: order create returned no id. Response: $resp"
  printf '%s' "$order_id"
}

# pso_push_orders <count> [tag] - loop wrapper, echoes the count actually
# created (a create failure dies the whole scenario via pso_ws_curl/die -
# there is deliberately no partial-success tolerance here, unlike
# of_push_orders' single bulk request: each order is its own multi-step
# webservice sequence and a partial failure midway (order created, its cart
# reused by nothing) is not a state worth limping past silently).
pso_push_orders() {
  local count="$1" tag="${2:-f11}" i=0 ids=()
  while [ "$i" -lt "$count" ]; do
    ids+=("$(pso_push_one_order "$tag")")
    i=$((i + 1))
  done
  log "pso_push_orders: created ${#ids[@]} order(s): ${ids[*]}"
  printf '%s' "${#ids[@]}"
}

# pso_orders_count - COUNT(*) on ps_orders, the same ground-truth read
# run-a4-ingest.sh / f10-dependency-failure.sh already use.
pso_orders_count() {
  as_count "$(ps_sql "SELECT COUNT(*) FROM ps_orders" 2>/dev/null | tr -d '[:space:]')"
}

# pso_enqueue_poll <connection_id> <tag> - enqueue one
# marketplace.orders.poll-shaped job for the PrestaShop source connection,
# mirroring of_enqueue_poll's reasoning: the scheduler stays off for the same
# co-tenancy-control reason, so the harness drives the poll cadence itself.
# The job type and payload shape are the shop-side counterpart
# (`prestashop-orders-poll` task / OrderSourcePort.listOrderFeed reading the
# date_upd watermark) - restated from the adapter/task rather than invented.
# The real scheduler task's default (prestashop-scheduler-tasks.ts:65),
# restated rather than invented for the same reason OF_POLL_LIMIT is.
PSO_POLL_LIMIT="${PSO_POLL_LIMIT:-100}"

pso_enqueue_poll() {
  local conn="$1" tag="${2:-f11}" key
  key="prestashop:$conn:orders:poll:$tag:$(date +%s%3N)"
  enqueue_perf_job 'marketplace.orders.poll' "$conn" \
    "{\"schemaVersion\":1,\"cursorKey\":\"$PSO_CURSOR_KEY\",\"limit\":$PSO_POLL_LIMIT}" "$key" >/dev/null
  printf '%s' "$key"
}
