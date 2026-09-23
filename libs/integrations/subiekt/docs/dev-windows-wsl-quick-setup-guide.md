# Dev quick-setup - PrestaShop + OpenLinker + Subiekt GT bridge on Windows + WSL2

Run the **whole local stack** on a single Windows 11 machine with WSL2 (Ubuntu) so you can
develop and test the Subiekt invoicing flow end-to-end: a shop (PrestaShop) that produces
orders, OpenLinker that orchestrates, and the Subiekt bridge + Subiekt GT that issue the
real documents.

> **Scope.** This is the **developer** quick-start (running everything locally for
> development/testing). For the operator-facing bridge configuration, the version
> support matrix, TLS/auth, and the full field list, see the
> [setup guide](./setup-guide.md) and the [runbook](./runbook.md). This doc links to them
> rather than repeating them, and focuses on the one thing that is unique to this topology:
> **how the WSL side talks to the Windows-side bridge.**

---

## The topology

Everything runs on **one physical machine**, split across two worlds:

```
┌─────────────────────────── Windows 11 host ───────────────────────────┐
│                                                                        │
│   Subiekt GT (desktop)            Subiekt bridge (.NET 8)              │
│         │  Sfera GT (COM,                 binds 0.0.0.0:5055 (https)  │
│         │   ProgID InsERT.GT)             and :5056 (http)             │
│         └───────────────────────────────────┘                         │
│                                            ▲                           │
│                                            │  http://<gateway-IP>:5055 │
│  ┌──────────────────────── WSL2 (Ubuntu) ──┼─────────────────────┐    │
│  │                                          │                     │    │
│  │   OpenLinker API  localhost:3000  (base path /v1) ────────────┘    │
│  │   OpenLinker web  localhost:4173                                 │  │
│  │   OpenLinker worker                                              │  │
│  │                                                                  │  │
│  │   Dev-stack Docker containers:                                   │  │
│  │     PrestaShop   localhost:8080   (admin / MySQL / phpMyAdmin)   │  │
│  │     phpMyAdmin   localhost:8081                                  │  │
│  │     Postgres 5432   Redis 6379   MySQL 3306                      │  │
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

**Why the split:** Subiekt GT is driven through **Sfera GT COM automation** (the COM
ProgID `InsERT.GT`), which is Windows-only and apartment-bound to the desktop session -
it needs the Subiekt GT installation plus SQL Server on the same machine. So Subiekt GT
and the bridge run **native on Windows**, while OpenLinker and its dev-stack containers
run **inside WSL2**. The interesting part is the seam between them.

> **Not Subiekt nexo, and not the .NET Sfera SDK.** This integration targets **Subiekt
> GT** (the InsERT GT product line), automated over classic **Sfera GT COM** (`InsERT.GT`).
> That is a different product and a different API from Subiekt nexo and its managed
> `InsERT.Moria.Sfera` SDK - do not mix up setup instructions between the two.

**The key fact:** WSL2 runs in its own virtual network. From WSL, the Windows host is **not**
`127.0.0.1` - it is the **WSL default gateway IP** (a `172.x.x.x` address WSL assigns). So
the WSL-hosted OpenLinker reaches the Windows-hosted bridge at
`http://<gateway-IP>:5055`, not `http://127.0.0.1:5055`.

---

## Prerequisites

- **Windows 11** with **WSL2** + an Ubuntu distro.
- Inside WSL: **Node.js 22+**, **pnpm 10+**, and **Docker** (Docker Desktop with WSL2
  integration, or Docker Engine inside the distro). The authoritative version table
  is [`README.md` § Runtime requirements](../../../../README.md#runtime-requirements).
- On Windows: **Subiekt GT** (InsERT GT product line - tested against **GT 1.89 SP1**),
  a **SQL Server** instance holding the Subiekt GT database, **.NET 8 SDK/runtime**, and the
  Subiekt bridge project built locally. See the
  [setup guide](./setup-guide.md#part-a--run-the-bridge-on-windows) for the bridge
  configuration details. There is no separate "Sfera SDK" install step - Sfera GT COM
  automation (ProgID `InsERT.GT`) is registered as part of the Subiekt GT installation.
- The OpenLinker monorepo cloned inside the WSL filesystem (not on `/mnt/c`, for I/O speed).

---

## Step 1 - Dev stack (PrestaShop et al.) in WSL

From the repo root inside WSL:

```bash
pnpm dev:stack:up            # postgres, redis, mysql, prestashop
pnpm dev:stack:devtools:up   # optional: adds phpmyadmin (devtools profile)
pnpm dev:stack:seed-prestashop   # seed currency + demo products into PrestaShop
```

> **This is the dev shortcut.** For the authoritative shop setup (webservice API key,
> catalog sync, category mapping, order ingestion) follow the canonical
> [Getting Started guide](../../../../docs/getting-started.md). The notes below are just the
> minimum to get PrestaShop actually serving so OpenLinker can talk to it - no hand-waving.

PrestaShop runs an **unattended install on first boot (~2-3 min)**. Wait for it, then verify:

```bash
curl -sI http://localhost:8080 | head -1     # expect: HTTP/1.1 302 Found (redirect to /en/)
```

On the first `docker compose up`, the post-install scripts in `docker/prestashop/post-install/`
run automatically and do real work (this is what trips people up - it is NOT a bare install):

- **rename the random `/admin{hash}/` folder to a stable `/admin-dev/`** so the back office URL is predictable,
- set **PLN** as the default currency,
- replace the upstream demo catalogue with **5 fixtures** sourced from real Allegro listings
  (the ones the barcode-linking / synthetic-variant tests exercise).

Re-seed any time (e.g. after breaking PS data during testing) with `pnpm dev:stack:seed-prestashop`.
A product you hand-add in the PS admin survives a re-seed **only** if its reference is prefixed
`OP-` (operator-preserve); anything else is treated as demo data and wiped.

The stack (from `docker-compose.yml`):

| Service | URL / port | Notes |
|---|---|---|
| PrestaShop storefront | `http://localhost:8080` | 302-redirects to `/en/` once installed |
| PrestaShop back office | `http://localhost:8080/admin-dev/` | login `demo@prestashop.com` / `prestashop_demo` |
| phpMyAdmin | `http://localhost:8081` | user `root` / password `root`; opt-in via `pnpm dev:stack:devtools:up` |
| Postgres (OpenLinker DB) | `localhost:5432` | `postgres` / `postgres`, db `openlinker` |
| Redis | `localhost:6379` | |
| MySQL (PrestaShop DB) | `localhost:3306` | `prestashop` / `prestashop` |

> **Back office URL.** The post-install `10-rename-admin.sh` renames PrestaShop's random
> admin folder to a **stable `/admin-dev/`**, so the back office is always at
> `http://localhost:8080/admin-dev/` - you do not have to hunt for a hashed folder name.
> If the URL still shows `/install`, the unattended install has not finished yet: wait a
> minute or watch `docker compose logs -f prestashop` (progress lines are tagged `[ps-post-install]`).

---

## Step 2 - OpenLinker API + web + worker in WSL

There is **no `.env` by default** - create one for the API:

```bash
cp apps/api/.env.example apps/api/.env
```

Then edit `apps/api/.env` and set at least:

- `NODE_ENV=development`
- `OL_CORS_ORIGIN` to include the web origin(s): `http://localhost:4173,http://localhost:5173`
- `OL_BOOTSTRAP_ADMIN_PASSWORD=admin` (any value; the bootstrap admin is created idempotently on first boot)

Build the workspace libraries first - **if the integration `dist/` folders are missing the
API won't boot**:

```bash
pnpm -r --filter "./libs/**" build
pnpm --filter @openlinker/api migration:run
```

Start the processes (separate terminals):

```bash
pnpm --filter @openlinker/api start:dev     # API on http://localhost:3000  (base path /v1)
pnpm --filter @openlinker/web dev           # web on http://localhost:4173
pnpm start:dev:worker                        # optional: background worker (auto-issue, reconcile jobs)
```

Verify:

```bash
curl -s http://localhost:3000/v1/health      # API up
pnpm dev:health                               # dev-stack health summary
```

Open the web UI at `http://localhost:4173` and log in with the bootstrap admin
(`admin` / `admin` in this worked example - matches `OL_BOOTSTRAP_ADMIN_PASSWORD`).

> **Note the web port.** This project's Vite config serves on **4173**, not the usual
> `5173`. Make sure `OL_CORS_ORIGIN` includes `http://localhost:4173` or the browser calls
> to the API are blocked by CORS.

---

## Step 3 - Subiekt GT + the bridge on Windows

Do this on the **Windows side** (a PowerShell terminal or `cmd` - you can even drive it
from WSL with `powershell.exe -NoProfile -Command "..."`). The deep configuration lives
in the [setup guide](./setup-guide.md#part-a--run-the-bridge-on-windows); the **dev
gotchas that cost hours** are below.

### 3.1 - Close the Subiekt GT desktop client

Sfera GT COM automation opens its session against the same desktop context Subiekt GT
runs in, and a stray modal dialog left open in the desktop client can block the bridge's
single COM worker thread forever. Close the Subiekt GT desktop client before starting the
bridge, and keep it closed while the bridge is running.

### 3.2 - Credentials and configuration

The bridge does **not** read a Sfera password from an environment variable or config
file - there is no `NexoPassword`/`SferaPassword`-style setting. Instead:

- **General endpoints** (products, inventory, orders - the WooCommerce-dialect surface)
  are protected by a **fixed Basic-auth username/password pair** baked into the bridge.
- **Invoicing endpoints** (`/api/*` - the `subiekt.gt.v1` contract) are protected
  by a **separate bearer token**, sent by OpenLinker as either an `Authorization: Bearer
  <token>` header or an `x-bridge-token: <token>` header.

Both values are configured into the bridge itself, not into OpenLinker or into a shared
`.env`. **Consult the bridge operator/maintainer for the actual credential values used
in your deployment** - they are not documented here and should never be hardcoded into a
shared config file.

The Sfera GT **database connection** is a plain SQL Server connection string, e.g.
(values are per-machine - this is a worked dev example, not a fixed requirement):

```
Server=<your-sqlserver-instance>;Database=<your-subiekt-gt-database>;
Integrated Security=True;TrustServerCertificate=True;Encrypt=False
```

On the machine this guide's examples were verified against, that was
`Server=DESKTOP-FJ0P3NU\INSERTNEXO;Database=DEMO` with Windows Integrated Security
(the SQL Server **instance name** happens to be `INSERTNEXO` on that machine - a legacy
naming artifact, not an indication that the product is "nexo"). Use whatever your own
SQL Server instance and database are actually named.

One environment variable the bridge **does** read:

- **`OL_BRIDGE_PUBLIC_BASE`** - the base URL image links in bridge responses are
  rewritten to. Defaults to `http://host.docker.internal:5056`. This exists because
  OpenLinker (and, through it, Allegro) fetches product images from **outside** the
  bridge machine's own loopback; `localhost`/`127.0.0.1` image URLs would fail there.
  Set this only if the default `host.docker.internal` hostname does not resolve from
  wherever the images are actually being fetched.

See the [setup guide](./setup-guide.md#part-a--run-the-bridge-on-windows) and
[runbook](./runbook.md#connection-configuration) for the full operational picture.

### 3.3 - Launch the bridge

The bridge ships with a `start-bridge.bat` launcher. Run it **directly** - double-click
it in Explorer, or run it from a `cmd`/PowerShell prompt in the bridge project's
directory:

```powershell
.\start-bridge.bat
```

It kills any already-running bridge process (`GtBridge.exe`) first, builds, then runs
the bridge in the foreground and keeps a **console window open with live logs**.

**There is no process supervision.** No Windows Service, no auto-restart, nothing
watches the bridge - it is a plain foreground console process for local development.
**Closing that console window stops the bridge.** If OpenLinker suddenly can't reach
the bridge, check first whether the console window is still open.

**Optional - launch it from WSL** (keeps everything except the Subiekt GT desktop app in
one WSL terminal). The bridge still runs **natively on Windows**; `powershell.exe` just
drives it from your WSL shell:

```bash
# from WSL - starts the Windows bridge in the background, logs to a file you can tail
powershell.exe -NoProfile -Command 'Start-Process cmd -ArgumentList "/c start-bridge.bat" -WorkingDirectory "C:\path\to\bridge" -WindowStyle Hidden'

# then check health from WSL too (via the gateway IP, see Step 4):
curl -sk https://172.26.96.1:5055/health
curl -s   http://172.26.96.1:5056/health
```

> **Two ports, two purposes.** The bridge listens on **`5055` (HTTPS, self-signed
> certificate)** for the real API traffic, and **`5056` (plain HTTP)** so a browser or an
> image-fetcher (OpenLinker, Allegro) can pull product images without having to trust a
> self-signed cert. Point OpenLinker's `bridgeBaseUrl` at `5055`; the `5056` port is for
> images only.

### 3.4 - Verify the bridge is up

```powershell
Invoke-RestMethod -SkipCertificateCheck https://127.0.0.1:5055/health
# → { "success": true, "data": { "ok": true }, "error": null }
```

The Sfera GT COM session is opened lazily on first use (and warmed up at bridge startup)
- there is no separate "connect" step to run by hand. If a call to a general endpoint
(products/inventory/orders) or an invoicing endpoint fails immediately after startup,
give the bridge a few seconds: a cold COM attach to Subiekt GT can take well over a
minute.

---

## Step 4 - Wire WSL to the Windows bridge (the tunnel)

This is the crux. The bridge binds on **all interfaces** on Windows (`5055`/`5056`) -
but WSL's own `127.0.0.1:5055` does **not** reach it, because WSL2 runs in its own
virtual network. From WSL you must use the **WSL default gateway IP**, which points at
the Windows host.

**Derive the gateway IP from inside WSL:**

```bash
ip route | grep default | awk '{print $3}'
# → 172.26.96.1   (example; yours will differ)
```

**Verify reachability from WSL:**

```bash
curl -sk https://172.26.96.1:5055/health
# → { "success": true, "data": { "ok": true }, "error": null }
```

> **This IP can change.** The `172.x.x.x` gateway address is assigned by WSL and **can
> change after a Windows or WSL restart**. If the bridge suddenly becomes unreachable from
> WSL, re-derive the gateway IP with the `ip route` command above and update the connection
> config (Step 4.1).

### 4.1 - Create the Subiekt connection in OpenLinker

In the OpenLinker web UI (`http://localhost:4173`) go to **Connections → Add connection** and
pick **Subiekt GT** (or use advanced mode). Use the **gateway URL** as the bridge base URL:

- **Platform type** `subiekt-gt`
- **Adapter key** `subiekt.gt.v1`
- **Enabled capabilities** `Invoicing`
- **Config JSON** `{ "bridgeBaseUrl": "https://172.26.96.1:5055" }` (your gateway IP, **no**
  `/api` suffix)
- **Bridge token** - the create DTO requires **exactly one** of credentials / credentialsRef.
  Use the bearer token configured into the bridge (Step 3.2).

Click **Test connection** - OpenLinker probes the bridge `/health` from the API (WSL) side.

> **Self-signed cert.** The bridge's HTTPS listener uses a self-signed certificate. If
> your local OpenLinker HTTP client validates TLS chains strictly, either trust the
> bridge's cert on the WSL side or point `bridgeBaseUrl` at the plain-HTTP `5056` port for
> local dev only - never do that against a real deployment.

> **Windows → WSL direction** (rarely needed - e.g. the bridge or PrestaShop calling back
> into OpenLinker): thanks to WSL `localhostForwarding`, WSL services are usually reachable
> from Windows at plain `localhost` (e.g. `http://localhost:3000`).

---

## Verify end-to-end

1. **Bridge reachable from WSL:** `curl -sk https://<gateway-IP>:5055/health` →
   `{"success":true,"data":{"ok":true},"error":null}`.
2. **Connection test** passes in the OpenLinker UI.
3. **Full invoice flow.** Create a PrestaShop order (see the
   [setup guide, Part C](./setup-guide.md#part-c--get-an-order-prestashop-example)), let
   OpenLinker ingest it, then issue the invoice from the order screen. The document appears
   in Subiekt GT (**Dokumenty → Sprzedaży**) and on OpenLinker's `/invoices` list.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `curl https://127.0.0.1:5055/health` from **WSL** fails/hangs | Loopback in WSL is not the Windows host. Use the **gateway IP** (`ip route \| grep default \| awk '{print $3}'`), e.g. `https://172.26.96.1:5055`. |
| Bridge was reachable, now times out from WSL | The WSL gateway `172.x.x.x` changed after a restart. Re-derive it and update the connection's `bridgeBaseUrl`. |
| Bridge console window shows nothing happening / connection refused | The console window running `start-bridge.bat` was closed - there is no process supervision, so closing it stops the bridge. Re-run `start-bridge.bat`. |
| `System.Runtime.InteropServices.COMException` / bridge hangs on a Sfera call | The Subiekt GT desktop client is open with a stray modal dialog, blocking the single COM worker thread. Close the desktop client and any of its dialogs, restart the bridge. |
| General endpoints (products/inventory/orders) return **401** | Basic-auth credentials wrong. Confirm the fixed username/password pair configured into the bridge (Step 3.2) - not an OpenLinker-side setting. |
| Invoicing endpoints (`/api/*`) return **401** | Bearer/`x-bridge-token` mismatch. Confirm the token in the OpenLinker connection matches the one configured into the bridge. |
| Images fail to load / Allegro reports `IMAGE_DOWNLOAD_FAILED` | The bridge's image URLs resolve to a host unreachable from the fetcher. Set `OL_BRIDGE_PUBLIC_BASE` to a base URL reachable from wherever OpenLinker/Allegro actually fetch images from. |
| Browser calls to the API blocked (CORS) | `OL_CORS_ORIGIN` must include `http://localhost:4173` (this project's web port, not 5173). |
| API won't boot | Integration `dist/` missing - run `pnpm -r --filter "./libs/**" build`, then re-run migrations. |
| A page reload drops you to `/login` | Known dev bug - see below (issue #1327). |

> **Known dev bug - session drops on reload (#1327).** The `ol_refresh` cookie is set with
> `Path=/auth`, but the refresh endpoint is `/v1/auth/refresh` (the `/v1` versioning prefix),
> so the browser never sends the refresh cookie and a full page reload drops the session to
> `/login`. Track it at
> [issue #1327](https://github.com/openlinker-project/openlinker/issues/1327). Log back in as
> a workaround.

---

## All URLs at a glance

| What | URL / value | Runs on |
|---|---|---|
| OpenLinker API | `http://localhost:3000` (base path `/v1`, e.g. `/v1/health`) | WSL |
| OpenLinker web (Vite) | `http://localhost:4173` | WSL |
| PrestaShop (storefront / back office) | `http://localhost:8080` / `http://localhost:8080/admin-dev/` | WSL (Docker) |
| phpMyAdmin | `http://localhost:8081` | WSL (Docker) |
| Postgres / Redis / MySQL | `localhost:5432` / `6379` / `3306` | WSL (Docker) |
| Subiekt bridge, HTTPS API (from Windows) | `https://127.0.0.1:5055` | Windows |
| Subiekt bridge, HTTP images (from Windows) | `http://127.0.0.1:5056` | Windows |
| Subiekt bridge (**from WSL**) | `https://<gateway-IP>:5055` - example `https://172.26.96.1:5055` | Windows, via WSL gateway |
| WSL → Windows gateway IP | `ip route \| grep default \| awk '{print $3}'` | derive per machine |
| Windows → WSL services | `http://localhost:<port>` (WSL `localhostForwarding`) | - |

**Values that vary per machine:** the WSL gateway IP (`172.26.96.1` here), the SQL Server
instance name and database holding Subiekt GT's data (`DESKTOP-FJ0P3NU\INSERTNEXO` /
`DEMO` here - a worked dev example, not a fixed value), and the Basic-auth /
bearer-token credentials configured into the bridge. The port numbers above (`5055`
HTTPS, `5056` HTTP) are fixed by the bridge's own Kestrel configuration.

---

## See also

- [Subiekt setup guide](./setup-guide.md) - operator-facing bridge + connection setup, TLS/auth.
- [Subiekt runbook](./runbook.md) - version matrix, config keys, troubleshooting reference.
- [Subiekt tutorial](./tutorial.md) - full order → invoice → verify walkthrough.
- [Getting Started](../../../../docs/getting-started.md) - canonical clean-machine setup (PrestaShop + Allegro, catalog + category mapping).
