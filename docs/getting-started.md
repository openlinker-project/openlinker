# Getting Started

End-to-end walkthrough: from a clean machine to a first Allegro order synced into PrestaShop via OpenLinker.

> **Status:** work in progress. Built incrementally as part of [#152](https://github.com/SilkSoftwareHouse/openlinker/issues/152). Sections marked _TBD_ are not yet documented.

## Prerequisites

- Docker + Docker Compose
- Node.js LTS, pnpm
- An Allegro sandbox account (https://apps.developer.allegro.pl.allegrosandbox.pl/)

## 1. Clean dev stack

Wipe any previous state and bring up Postgres, Redis, MySQL, and PrestaShop:

```bash
docker compose down -v
pnpm install
pnpm dev:stack:up
```

Wait until PrestaShop finishes its unattended install (~2–3 min). Check:

```bash
docker compose ps
curl -sI http://localhost:8080 | head -1   # expect 302 → /en/
```

Log in to the PrestaShop admin at **http://localhost:8080/admin-dev/** with the default credentials (set in `docker-compose.yml`):

- Email: `demo@prestashop.com`
- Password: `prestashop_demo`

> If you still see `/install` in the URL, the auto-install hasn't completed yet — wait another minute, or `docker compose logs -f prestashop` to watch progress.

## 2. Environment, migrations & apps

Copy the example env file and adjust if needed (defaults match the dev stack):

```bash
cp apps/api/.env.example apps/api/.env.local
```

Run migrations, then start the API and the web app (in separate terminals):

```bash
pnpm --filter @openlinker/api migration:run
pnpm start:dev:api       # http://localhost:3000
pnpm start:dev:web       # http://localhost:5173
```

Health check:

```bash
curl -s http://localhost:3000/health/dev-stack | jq .
```

## 3. Admin user & login

Log in at http://localhost:5173.

- Default admin seeding is tracked in [#157](https://github.com/SilkSoftwareHouse/openlinker/issues/157).
- Password reset flow is tracked in [#158](https://github.com/SilkSoftwareHouse/openlinker/issues/158).

## 4. PrestaShop connection

_TBD_

## 5. Allegro connection (OAuth sandbox)

_TBD_

## 6. Initial catalog & inventory pull

_TBD_

## 7. Category & attribute mapping

_TBD_

## 8. First offer

_TBD_

## 9. First order end-to-end

_TBD_
