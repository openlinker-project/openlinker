# Implementation Plan: Operational Dashboard (#101)

## Goal

Replace placeholder content in the dashboard with real sync job data from existing APIs.

## Classification

**Frontend / Feature** — `apps/web/src/pages/dashboard/`

## Dependencies (all merged)

- #70 — Sync jobs read API (`GET /sync/jobs`)
- #65 — Connection diagnostics API (`GET /health/dev-stack`)

## Changes

### 1. `apps/web/src/pages/dashboard/dashboard-page.tsx`

- Import `useSyncJobsQuery` from sync-jobs feature
- **Metric cards:**
  - "Jobs needing attention" → count of `dead` status jobs
  - "Manual reviews" → count of `queued` jobs
- **Panels:**
  - "Recent sync events" → DataTable with last 5 jobs (all statuses), columns: type, status, connection, updated
  - "Retry and incident queue" → DataTable with `dead` jobs, columns: type, error, attempts, updated
- Wire refresh button to refetch sync jobs query
- Handle loading/error/empty for each new section

### 2. `apps/web/src/pages/dashboard/dashboard-page.test.tsx`

- Test sync jobs metric cards show real counts
- Test recent sync events table renders job rows
- Test failed jobs table renders dead jobs
- Test loading/error states for sync data

## Non-goals

- No new API endpoints
- No new shared components
- No CSS additions (existing styles sufficient)
- No pagination on dashboard tables (fixed limit of 5)
