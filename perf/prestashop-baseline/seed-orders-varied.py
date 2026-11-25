#!/usr/bin/env python3
"""Seed a PrestaShop stack with a large, varied order history (#4228).

Where `seed-orders.sh` clones whole orders, this one builds orders the way a
shop with real traffic looks: many customers (each with an address), orders
spread over years, one to three lines per order drawn from the shop's real
products AND their combinations (variants), mixed quantities and order states.
Everything is written straight into MySQL, so ten thousand orders take seconds
instead of the webservice's four requests per order.

Usage: seed-orders-varied.py [ORDERS=10000] [DAYS=730] [CUSTOMERS=1500] [MYSQL_CONTAINER]
Needs the shop's products, one existing customer with an address (id 2 and its
address) and one existing order with a line and a carrier row (order id 1) to
use as templates. Re-running adds more.
"""
import random
import string
import subprocess
import sys
from datetime import datetime, timedelta

ORDERS = int(sys.argv[1]) if len(sys.argv) > 1 else 10000
DAYS = int(sys.argv[2]) if len(sys.argv) > 2 else 730
CUSTOMERS = int(sys.argv[3]) if len(sys.argv) > 3 else 1500
CONTAINER = sys.argv[4] if len(sys.argv) > 4 else "ol-shopify-e2e-mysql"
TEMPLATE_CUSTOMER = 2
TEMPLATE_ORDER = 1

FIRST = ["Anna", "Piotr", "Katarzyna", "Marek", "Ewa", "Tomasz", "Agnieszka", "Jan", "Maria", "Krzysztof",
         "Joanna", "Andrzej", "Magdalena", "Pawel", "Barbara", "Michal", "Monika", "Jakub", "Dorota", "Adam"]
LAST = ["Kowalski", "Nowak", "Wisniewski", "Wojcik", "Kaminski", "Lewandowski", "Zielinski", "Szymanski",
        "Wozniak", "Dabrowski", "Kozlowski", "Jankowski", "Mazur", "Kwiatkowski", "Krawczyk", "Piotrowski"]
CITIES = [("Warszawa", "00-001"), ("Krakow", "30-001"), ("Gdansk", "80-001"), ("Wroclaw", "50-001"),
          ("Poznan", "60-001"), ("Lodz", "90-001"), ("Szczecin", "70-001"), ("Lublin", "20-001")]
# Mostly accepted or shipped, a tail of awaiting, delivered and cancelled orders.
STATES = [2] * 30 + [4] * 25 + [5] * 20 + [1] * 8 + [6] * 6 + [3] * 5 + [8] * 3 + [10] * 3

random.seed(4228)


def mysql(sql: str, batch: bool = True) -> str:
    cmd = ["docker", "exec", "-i", CONTAINER, "sh", "-c",
           'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" ' + ("-N -B" if batch else "")]
    done = subprocess.run(cmd, input=sql, capture_output=True, text=True, encoding="utf-8", errors="replace")
    err = "\n".join(l for l in done.stderr.splitlines() if "Using a password" not in l)
    if done.returncode != 0:
        raise SystemExit(f"mysql failed: {err}")
    return done.stdout


def columns(table: str):
    rows = mysql(
        "select column_name, data_type, is_nullable from information_schema.columns "
        f"where table_schema=database() and table_name='{table}' order by ordinal_position;"
    ).strip().splitlines()
    return [tuple(r.split("\t")) for r in rows]


def clone_select(cols, skip, overrides):
    """SELECT list that copies every column, with overrides. A zero datetime in the
    template cannot be copied under strict mode, so datetimes become @ts or NULL."""
    parts = []
    for name, kind, nullable in cols:
        if name == skip:
            continue
        if name in overrides:
            parts.append(overrides[name])
        elif kind in ("datetime", "timestamp"):
            parts.append("NULL" if nullable == "YES" else "@ts")
        elif kind == "date":
            parts.append("NULL" if nullable == "YES" else "CURDATE()")
        else:
            parts.append(name)
    names = ",".join(c[0] for c in cols if c[0] != skip)
    return names, ",".join(parts)


# --- the shop's real catalogue: simple products and their combinations --------------------------
products = {}
for row in mysql(
    "select p.id_product, p.price, coalesce((select max(t.rate) from ps_tax_rule tr join ps_tax t on t.id_tax=tr.id_tax "
    "where tr.id_tax_rules_group=p.id_tax_rules_group),0), p.reference, pl.name "
    "from ps_product p join ps_product_lang pl on pl.id_product=p.id_product and pl.id_lang=1 where p.active=1;"
).strip().splitlines():
    pid, price, rate, ref, name = row.split("\t")
    products[int(pid)] = dict(price=float(price), rate=float(rate), ref=ref, name=name.replace("'", "''"))
items = []  # (product id, attribute id, name, net price, rate, reference)
combos = {}
for row in mysql("select id_product, id_product_attribute, price, reference from ps_product_attribute;").strip().splitlines():
    pid, paid, impact, ref = row.split("\t")
    combos.setdefault(int(pid), []).append((int(paid), float(impact), ref))
for pid, p in products.items():
    if pid in combos:
        for paid, impact, ref in combos[pid]:
            items.append((pid, paid, f"{p['name']} - {ref}", p["price"] + impact, p["rate"], ref))
    else:
        items.append((pid, 0, p["name"], p["price"], p["rate"], p["ref"]))
if not items:
    raise SystemExit("the shop has no active products to sell")

c_cols, a_cols = columns("ps_customer"), columns("ps_address")
o_cols, d_cols, k_cols = columns("ps_orders"), columns("ps_order_detail"), columns("ps_order_carrier")
tpl_address = mysql(f"select id_address from ps_address where id_customer={TEMPLATE_CUSTOMER} and deleted=0 limit 1;").strip()
if not tpl_address:
    raise SystemExit(f"template customer {TEMPLATE_CUSTOMER} has no address")
tpl_detail = mysql(f"select id_order_detail from ps_order_detail where id_order={TEMPLATE_ORDER} limit 1;").strip()
first_customer = int(mysql("select coalesce(max(id_customer),0)+1 from ps_customer;").strip())
stamp = datetime.now().strftime("%m%d%H%M%S")

out = ["SET autocommit=0; SET unique_checks=0; SET foreign_key_checks=0;"]
now = datetime.now()

# --- customers, each with one address -----------------------------------------------------------
for n in range(CUSTOMERS):
    first, last = random.choice(FIRST), random.choice(LAST)
    city, zipcode = random.choice(CITIES)
    ts = (now - timedelta(days=random.randint(DAYS, DAYS + 200))).strftime("%Y-%m-%d %H:%M:%S")
    out.append(f"SET @ts='{ts}';")
    names, sel = clone_select(c_cols, "id_customer", {
        "firstname": f"'{first}'", "lastname": f"'{last}'",
        "email": f"'seed{stamp}c{n}@seed.openlinker.test'",
        "passwd": "MD5(RAND())", "secure_key": "MD5(RAND())", "date_add": "@ts", "date_upd": "@ts",
    })
    out.append(f"INSERT INTO ps_customer ({names}) SELECT {sel} FROM ps_customer WHERE id_customer={TEMPLATE_CUSTOMER};")
    out.append("SET @c=LAST_INSERT_ID();")
    out.append(f"INSERT INTO ps_customer_group (id_customer,id_group) SELECT @c,id_group FROM ps_customer_group WHERE id_customer={TEMPLATE_CUSTOMER};")
    names, sel = clone_select(a_cols, "id_address", {
        "id_customer": "@c", "alias": f"'seed-{n}'", "firstname": f"'{first}'", "lastname": f"'{last}'",
        "address1": f"'ul. Testowa {random.randint(1, 120)}'", "city": f"'{city}'", "postcode": f"'{zipcode}'",
        "date_add": "@ts", "date_upd": "@ts",
    })
    out.append(f"INSERT INTO ps_address ({names}) SELECT {sel} FROM ps_address WHERE id_address={tpl_address};")
    if n % 500 == 499:
        out.append("COMMIT;")
out.append("COMMIT;")
mysql("\n".join(out))

customer_ids = list(range(first_customer, first_customer + CUSTOMERS))
address_of = {int(r.split("\t")[1]): int(r.split("\t")[0]) for r in mysql(
    f"select id_address, id_customer from ps_address where id_customer>={first_customer};").strip().splitlines()}

# --- orders, oldest first so ids and dates run together -----------------------------------------
out = ["SET autocommit=0; SET unique_checks=0; SET foreign_key_checks=0;"]
for i in range(ORDERS):
    age_seconds = (ORDERS - i) * DAYS * 86400 / ORDERS + random.randint(0, 40000)
    added = now - timedelta(seconds=age_seconds)
    updated = min(now, added + timedelta(seconds=random.choice([0, 0, 0, 600, 86400, 172800])))
    state = random.choice(STATES)
    customer = random.choice(customer_ids)
    address = address_of[customer]
    chosen = random.sample(items, k=random.choice([1, 1, 1, 2, 2, 3]))
    lines = [(it, random.choice([1, 1, 1, 2, 3])) for it in chosen]
    net = sum(it[3] * q for it, q in lines)
    gross = sum(it[3] * (1 + it[4] / 100) * q for it, q in lines)
    ref = "".join(random.choices(string.ascii_uppercase, k=9))
    out.append(f"SET @ts='{added:%Y-%m-%d %H:%M:%S}'; SET @up='{updated:%Y-%m-%d %H:%M:%S}';")
    names, sel = clone_select(o_cols, "id_order", {
        "reference": f"'{ref}'", "id_customer": str(customer), "id_address_delivery": str(address),
        "id_address_invoice": str(address), "id_currency": "1", "conversion_rate": "1", "current_state": str(state),
        "total_paid": f"{gross:.6f}", "total_paid_tax_incl": f"{gross:.6f}", "total_paid_tax_excl": f"{net:.6f}",
        "total_paid_real": f"{gross:.6f}", "total_products": f"{net:.6f}", "total_products_wt": f"{gross:.6f}",
        "total_shipping": "0", "total_shipping_tax_incl": "0", "total_shipping_tax_excl": "0",
        "date_add": "@ts", "date_upd": "@up", "invoice_date": "@ts", "delivery_date": "@ts",
    })
    out.append(f"INSERT INTO ps_orders ({names}) SELECT {sel} FROM ps_orders WHERE id_order={TEMPLATE_ORDER};")
    out.append("SET @o=LAST_INSERT_ID();")
    for (pid, paid, name, price, rate, sku), qty in lines:
        incl = price * (1 + rate / 100)
        names, sel = clone_select(d_cols, "id_order_detail", {
            "id_order": "@o", "product_id": str(pid), "product_attribute_id": str(paid),
            "product_name": f"'{name.replace(chr(39), chr(39) * 2)}'", "product_quantity": str(qty),
            "product_price": f"{price:.6f}", "product_reference": f"'{sku}'", "tax_rate": f"{rate:.3f}",
            "unit_price_tax_incl": f"{incl:.6f}", "unit_price_tax_excl": f"{price:.6f}",
            "total_price_tax_incl": f"{incl * qty:.6f}", "total_price_tax_excl": f"{price * qty:.6f}",
            "original_product_price": f"{price:.6f}", "download_deadline": "NULL",
        })
        out.append(f"INSERT INTO ps_order_detail ({names}) SELECT {sel} FROM ps_order_detail WHERE id_order_detail={tpl_detail};")
    out.append(f"INSERT INTO ps_order_history (id_employee,id_order,id_order_state,date_add) VALUES (0,@o,{state},@ts);")
    names, sel = clone_select(k_cols, "id_order_carrier", {
        "id_order": "@o", "date_add": "@ts", "shipping_cost_tax_excl": "0", "shipping_cost_tax_incl": "0",
        "tracking_number": "''",
    })
    out.append(f"INSERT INTO ps_order_carrier ({names}) SELECT {sel} FROM ps_order_carrier WHERE id_order={TEMPLATE_ORDER};")
    if i % 500 == 499:
        out.append("COMMIT;")
out.append("COMMIT;")
mysql("\n".join(out))

print(mysql(
    "select count(*) orders, min(date_add) oldest, max(date_add) newest, count(distinct id_customer) customers from ps_orders;",
    batch=False,
))
print(mysql(
    "select count(*) order_lines, count(distinct concat(product_id,'-',product_attribute_id)) distinct_items from ps_order_detail;",
    batch=False,
))
