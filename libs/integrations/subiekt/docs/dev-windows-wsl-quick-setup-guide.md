# Dev quick-setup - PrestaShop + OpenLinker + Subiekt bridge on Windows + WSL2

Run the **whole local stack** on a single Windows 11 machine with WSL2 (Ubuntu) so you can
develop and test the Subiekt invoicing flow end-to-end: a shop (PrestaShop) that produces
orders, OpenLinker that orchestrates, and the Subiekt bridge + Subiekt nexo that issue the
real documents.

> **Scope.** This is the **developer** quick-start (running everything locally for
> development/testing). For the operator-facing bridge/Sfera configuration, the version
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
│   Subiekt nexo (desktop)          Subiekt bridge (.NET 8, WinExe)      │
│         │  Sfera SDK                     binds 127.0.0.1:5005          │
│         └───────────────────────────────────┘                         │
│                                            ▲                           │
│                                            │  http://<gateway-IP>:5005 │
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

**Why the split:** the InsERT **Sfera SDK is Windows-only** - it needs the InsERT nexo
binaries plus SQL Server. So Subiekt nexo and the bridge run **native on Windows**, while
OpenLinker and its dev-stack containers run **inside WSL2**. The interesting part is the
seam between them.

**The key fact:** WSL2 runs in its own virtual network. From WSL, the Windows host is **not**
`127.0.0.1` - it is the **WSL default gateway IP** (a `172.x.x.x` address WSL assigns). So
the WSL-hosted OpenLinker reaches the Windows-hosted bridge at
`http://<gateway-IP>:5005`, not `http://127.0.0.1:5005`.

---

## Prerequisites

- **Windows 11** with **WSL2** + an Ubuntu distro.
- Inside WSL: **Node.js 18+**, **pnpm 9+**, and **Docker** (Docker Desktop with WSL2
  integration, or Docker Engine inside the distro).
- On Windows: **Subiekt nexo PRO + Sfera**, **.NET 8 runtime/SDK**, **SQL Server** (the
  `INSERTNEXO` instance the nexo installer creates), and the
  [`openlinker-subiekt-bridge`](https://github.com/openlinker-project/openlinker-subiekt-bridge)
  repo built locally. See the [setup guide](./setup-guide.md#part-a--run-the-bridge-on-windows)
  for the bridge/Sfera details.
- The OpenLinker monorepo cloned inside the WSL filesystem (not on `/mnt/c`, for I/O speed).

---

## Step 1 - Dev stack (PrestaShop et al.) in WSL

From the repo root inside WSL:

```bash
pnpm dev:stack:up            # postgres, redis, mysql, phpmyadmin, prestashop
pnpm dev:stack:seed-prestashop   # seed currency + demo products into PrestaShop
```

The stack (from `docker-compose.yml`):

| Service | URL / port | Notes |
|---|---|---|
| PrestaShop storefront + back office | `http://localhost:8080` | `PS_DOMAIN=localhost:8080`, admin folder `admin` |
| PrestaShop admin login | see below | `ADMIN_MAIL=demo@prestashop.com`, `ADMIN_PASSWD=prestashop_demo` |
| phpMyAdmin | `http://localhost:8081` | user `root` / password `root` |
| Postgres (OpenLinker DB) | `localhost:5432` | `postgres` / `postgres`, db `openlinker` |
| Redis | `localhost:6379` | |
| MySQL (PrestaShop DB) | `localhost:3306` | `prestashop` / `prestashop` |

> **PrestaShop admin folder.** The compose sets `PS_FOLDER_ADMIN=admin`, but PrestaShop
> randomizes the admin folder on install and the post-install script renames it back.
> If `http://localhost:8080/admin` 404s, check the actual folder name on your machine
> (list `admin*` folders in the container: `docker compose exec prestashop ls /var/www/html | grep -i admin`).

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

## Step 3 - Subiekt nexo + the bridge on Windows

Do this on the **Windows side** (a PowerShell terminal - you can even drive it from WSL with
`powershell.exe -NoProfile -Command "..."`). The deep configuration lives in the
[setup guide](./setup-guide.md#part-a--run-the-bridge-on-windows); the **dev gotchas that
cost hours** are below.

### 3.1 - Close the Subiekt nexo desktop client

Sfera has a **single-session licence**. If the desktop Subiekt nexo client is open, the
bridge's Sfera connect **hangs** waiting for the licence. Close nexo before starting the
bridge.

### 3.2 - Configure the base `appsettings.json`

The base `appsettings.json` (gitignored) must carry the **real** Sfera config. For local dev
set `Port=5005` and `Auth.Enabled=false`. Worked-example values on this machine:

```jsonc
{
  "Port": 5005,
  "Auth": { "Enabled": false },
  "Sfera": {
    "BinariesDir": "C:\\Users\\42zer\\AppData\\Local\\InsERT\\Deployments\\Nexo\\Demo_1269000381e084a6bb1f8d36d8c\\Binaries",
    "ConfigDir":   "C:\\Users\\42zer\\AppData\\Local\\InsERT\\Deployments\\Nexo\\Demo_1269000381e084a6bb1f8d36d8c\\...",
    "TempDir":     "C:\\Users\\42zer\\AppData\\Local\\InsERT\\Deployments\\Nexo\\Demo_1269000381e084a6bb1f8d36d8c\\...",
    "SqlServer":   "localhost\\INSERTNEXO",
    "SqlDatabase": "Nexo_Demo_1",
    "SqlUseWindowsAuth": true,
    "NexoUser":    "<operator-account>"   // a nexo operator with minimal rights, NOT "Szef"
    // NexoPassword - set via env / your local file; never commit it
  }
}
```

See the [setup guide](./setup-guide.md#part-a--run-the-bridge-on-windows) and
[runbook](./runbook.md#connection-configuration) for the full field list.

### 3.3 - Set `ASPNETCORE_ENVIRONMENT=Development` before launching

This is the single biggest time-sink if you miss it. The **default environment is
Production**, and `appsettings.Production.json` ships **template placeholders** that
**override** your real base `appsettings.json`:

- `Sfera.BinariesDir` becomes a non-existent path
  (`C:\Users\<USER>\AppData\Local\InsERT\Deployments\Nexo\<WDROZENIE>\Binaries`), so any
  Sfera call throws
  `System.IO.FileNotFoundException: Could not load file or assembly 'InsERT.Moria.Sfera'`.
- `Auth.Enabled=true` with an empty key, so **every `/api/*` returns 401**.

`Development` loads only the base `appsettings.json` (real `BinariesDir`, Auth disabled), so
set it first:

```powershell
$env:ASPNETCORE_ENVIRONMENT = "Development"
```

### 3.4 - Launch via the .NET muxer, NOT the apphost

Run the bridge through `dotnet`:

```powershell
dotnet Subiekt.Bridge.Api.dll
```

**Do NOT double-click / launch `Subiekt.Bridge.Api.exe`.** The project is
`net8.0-windows` with `UseWPF=true`, so the apphost is a **WinExe (GUI subsystem) with no
console** - it produces **zero stdout/stderr**, so startup failures are completely silent.
The `dotnet <dll>` muxer runs it as a console app with full logs.

> **Tip.** Copy the build output (`bin/Debug/net8.0-windows`) to a local Windows dir such as
> `C:\subiekt-bridge-run` and run from there. Running over the `\\wsl.localhost\Ubuntu\...`
> UNC path is slow.

### 3.5 - Connect the Sfera session

`AutoConnect` is off in the base dev config, so Sfera is **not** connected automatically.
After the bridge is up, connect explicitly:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:5005/api/session/connect
```

Verify the bridge is healthy and connected:

```powershell
Invoke-RestMethod http://127.0.0.1:5005/health
# → {"status":"ok","bridge":"up","sferaSession":"valid","subiekt":"reachable"}
Invoke-RestMethod http://127.0.0.1:5005/api/session/status
# → { "connected": true, ... }
```

---

## Step 4 - Wire WSL to the Windows bridge (the tunnel)

This is the crux. The bridge binds `127.0.0.1:5005` **on Windows** - WSL's own
`127.0.0.1:5005` does **not** reach it. From WSL you must use the **WSL default gateway IP**,
which points at the Windows host.

**Derive the gateway IP from inside WSL:**

```bash
ip route | grep default | awk '{print $3}'
# → 172.26.96.1   (example; yours will differ)
```

**Verify reachability from WSL:**

```bash
curl -s http://172.26.96.1:5005/health
# → {"status":"ok","bridge":"up","sferaSession":"valid","subiekt":"reachable"}
```

> **This IP can change.** The `172.x.x.x` gateway address is assigned by WSL and **can
> change after a Windows or WSL restart**. If the bridge suddenly becomes unreachable from
> WSL, re-derive the gateway IP with the `ip route` command above and update the connection
> config (Step 4.2).

### 4.1 - Fallback if the gateway IP doesn't reach a loopback-bound bridge

On some machines a loopback-bound (`127.0.0.1`) bridge is **not** reachable via the gateway
IP. Two options:

1. **`netsh` port-proxy on Windows** - forward the Windows host interface to the loopback
   listener:
   ```powershell
   netsh interface portproxy add v4tov4 listenport=5005 listenaddress=0.0.0.0 connectport=5005 connectaddress=127.0.0.1
   ```
2. **Bind the bridge to a non-loopback host** - but the bridge **refuses** a non-loopback
   bind unless `Auth.Enabled=true` (with a non-empty `ApiKey`) **and** HTTPS/TLS are
   configured (fail-closed). See the [runbook](./runbook.md#bridge-configuration-windows)
   for that config.

### 4.2 - Create the Subiekt connection in OpenLinker

In the OpenLinker web UI (`http://localhost:4173`) go to **Connections → Add connection** and
pick **Subiekt nexo** (or use advanced mode). Use the **gateway URL** as the bridge base URL:

- **Platform type** `subiekt`
- **Adapter key** `subiekt.invoicing.v1`
- **Enabled capabilities** `Invoicing`
- **Config JSON** `{ "bridgeBaseUrl": "http://172.26.96.1:5005" }` (your gateway IP, **no**
  `/api` suffix)
- **Bridge token** - the create DTO requires **exactly one** of credentials / credentialsRef,
  even though the local bridge has `Auth.Enabled=false`. A **dummy token** is fine locally.

Click **Test connection** - OpenLinker probes the bridge `/health` from the API (WSL) side.

> **Windows → WSL direction** (rarely needed - e.g. the bridge or PrestaShop calling back
> into OpenLinker): thanks to WSL `localhostForwarding`, WSL services are usually reachable
> from Windows at plain `localhost` (e.g. `http://localhost:3000`).

---

## Verify end-to-end

1. **Bridge reachable from WSL:** `curl -s http://<gateway-IP>:5005/health` →
   `sferaSession:"valid"`, `subiekt:"reachable"`.
2. **Connection test** passes in the OpenLinker UI.
3. **Bridge-backed pickers render.** The OpenLinker API proxies two bridge reads
   server-side, used by the connection-edit UI pickers (payment-method / bank-account /
   Stanowisko-Kasowe):
   - `GET /v1/integrations/subiekt/connections/{id}/bank-accounts`
   - `GET /v1/integrations/subiekt/connections/{id}/cash-registers`

   On this worked example they returned the bridge's live **5 bank accounts** and
   **4 cash registers** from `Nexo_Demo_1`, and the connection-edit form rendered them in the
   pickers.
4. **Full invoice flow.** Create a PrestaShop order (see the
   [setup guide, Part C](./setup-guide.md#part-c--get-an-order-prestashop-example)), let
   OpenLinker ingest it, then issue the invoice from the order screen. The document appears
   in Subiekt nexo (**Dokumenty → Sprzedaży**) and on OpenLinker's `/invoices` list.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `curl http://127.0.0.1:5005/health` from **WSL** fails/hangs | Loopback in WSL is not the Windows host. Use the **gateway IP** (`ip route \| grep default \| awk '{print $3}'`), e.g. `http://172.26.96.1:5005`. |
| Bridge was reachable, now times out from WSL | The WSL gateway `172.x.x.x` changed after a restart. Re-derive it and update the connection's `bridgeBaseUrl`. |
| Gateway IP still can't reach a loopback bridge | Add a `netsh interface portproxy` rule on Windows, or bind non-loopback **with** Auth + TLS (Step 4.1). |
| Bridge starts but shows no logs / seems to do nothing | You launched `Subiekt.Bridge.Api.exe` (WinExe, no console). Launch `dotnet Subiekt.Bridge.Api.dll` instead. |
| `FileNotFoundException: ... 'InsERT.Moria.Sfera'` on any Sfera call | Running in **Production** env, whose `appsettings.Production.json` placeholders overrode `BinariesDir`. Set `ASPNETCORE_ENVIRONMENT=Development`. |
| Every `/api/*` returns **401** locally | Same Production-env problem: `Auth.Enabled=true` with an empty key. Set `ASPNETCORE_ENVIRONMENT=Development` (base config disables Auth). |
| Bridge's Sfera connect **hangs** on start | The desktop Subiekt nexo client is open - single-session licence. Close nexo, restart the bridge. |
| `/health` shows `subiekt` not reachable / `sferaSession` invalid | Sfera not connected - `POST /api/session/connect` (AutoConnect is off in dev). |
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
| PrestaShop | `http://localhost:8080` | WSL (Docker) |
| phpMyAdmin | `http://localhost:8081` | WSL (Docker) |
| Postgres / Redis / MySQL | `localhost:5432` / `6379` / `3306` | WSL (Docker) |
| Subiekt bridge (from Windows) | `http://127.0.0.1:5005` | Windows |
| Subiekt bridge (**from WSL**) | `http://<gateway-IP>:5005` - example `http://172.26.96.1:5005` | Windows, via WSL gateway |
| WSL → Windows gateway IP | `ip route \| grep default \| awk '{print $3}'` | derive per machine |
| Windows → WSL services | `http://localhost:<port>` (WSL `localhostForwarding`) | - |

**Values that vary per machine:** the WSL gateway IP (`172.26.96.1` here), the Sfera
`BinariesDir`/`ConfigDir`/`TempDir` deployment folder, the Windows username (`42zer` here),
and the Nexo database name (`Nexo_Demo_1` here). The port numbers above are fixed by the repo
config.

---

## See also

- [Subiekt setup guide](./setup-guide.md) - operator-facing bridge + connection setup, TLS/auth.
- [Subiekt runbook](./runbook.md) - version matrix, config keys, troubleshooting reference.
- [Subiekt tutorial](./tutorial.md) - full order → invoice → verify walkthrough.
