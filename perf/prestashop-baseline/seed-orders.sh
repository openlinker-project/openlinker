#!/usr/bin/env bash
# Seed a PrestaShop stack with many historical orders, spread over past days.
#
# Clones existing orders (header, lines, history, carrier) straight in MySQL, so
# thousands of orders take seconds instead of the webservice's ~4 requests per
# order. Used to exercise order-sync start ("only new / from a date / all
# history", #4228): the orders are dated in the past, so "from a date" has a
# real before and after.
#
# Usage: seed-orders.sh [COUNT=4000] [DAYS=150] [MYSQL_CONTAINER=ol-shopify-e2e-mysql]
# Needs at least one real order in the shop to clone. Re-running adds more.
set -euo pipefail

COUNT="${1:-4000}"
DAYS="${2:-150}"
CONTAINER="${3:-ol-shopify-e2e-mysql}"

mysql_run() {
  docker exec -i "$CONTAINER" sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" "$@"' _ "$@" \
    2> >(grep -v 'Using a password' >&2)
}

cols() {
  mysql_run -N -e "select group_concat(column_name order by ordinal_position) from information_schema.columns where table_schema=database() and table_name='$1'"
}

python3 - "$COUNT" "$DAYS" "$(cols ps_orders)" "$(cols ps_order_detail)" "$(cols ps_order_carrier)" <<'PY' | mysql_run
import random, string, sys
from datetime import datetime, timedelta

count, days = int(sys.argv[1]), int(sys.argv[2])
orders, detail, carrier = (c.strip().split(',') for c in sys.argv[3:6])
templates = [1, 2, 8, 9, 10, 11, 14, 17]
random.seed(4228)
now = datetime.now()

def select(cols, overrides):
    return ','.join(overrides.get(c, c) for c in cols)

def insert_cols(cols, skip):
    return ','.join(c for c in cols if c != skip)

print('SET autocommit=0; SET unique_checks=0; SET foreign_key_checks=0;')
for i in range(count):
    age = timedelta(seconds=(count - i) * days * 86400 / count + random.randint(0, 3600))
    ts = (now - age).strftime('%Y-%m-%d %H:%M:%S')
    ref = ''.join(random.choices(string.ascii_uppercase, k=9))
    t = templates[i % len(templates)]
    print(f"SET @ts='{ts}';")
    o = {'reference': f"'{ref}'", 'date_add': '@ts', 'date_upd': '@ts', 'invoice_date': '@ts', 'delivery_date': '@ts'}
    print(f"INSERT INTO ps_orders ({insert_cols(orders,'id_order')}) SELECT {select([c for c in orders if c!='id_order'], o)} FROM ps_orders WHERE id_order={t};")
    print('SET @o=LAST_INSERT_ID();')
    print(f"INSERT INTO ps_order_detail ({insert_cols(detail,'id_order_detail')}) SELECT {select([c for c in detail if c!='id_order_detail'], {'id_order':'@o','download_deadline':'NULL'})} FROM ps_order_detail WHERE id_order={t};")
    print(f"INSERT INTO ps_order_history (id_employee,id_order,id_order_state,date_add) SELECT 0,@o,current_state,@ts FROM ps_orders WHERE id_order=@o;")
    print(f"INSERT INTO ps_order_carrier ({insert_cols(carrier,'id_order_carrier')}) SELECT {select([c for c in carrier if c!='id_order_carrier'], {'id_order':'@o','date_add':'@ts'})} FROM ps_order_carrier WHERE id_order={t};")
    if i % 500 == 499:
        print('COMMIT;')
print('COMMIT;')
PY

mysql_run -e "select count(*) as orders, min(date_add) as oldest, max(date_add) as newest from ps_orders"
