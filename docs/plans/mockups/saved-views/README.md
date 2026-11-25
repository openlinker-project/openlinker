# Saved views prototype

Design of record for #4241 (`saved-views-prototype.html`, with `engine.jsx`, `pages.jsx`, `app.jsx`, `extra.css`). The shipped code is generated from it, so the differences are listed here.

Differences between the prototype and what shipped:

- The prototype shows built-in views for every page; the shipped registries define only the system views each page's list DTO can express. A "Late to ship" view is omitted because it depends on a relative date, which a stored filter query cannot hold.
- Four lists ship with built-in views only (`customViews: false`): Customers, Sales documents, Sync jobs, Webhook deliveries. Views for `failed-orders` and `dispatch-risk` are not done.
- Stored queries use the list DTO's key names, not the URL param names (Orders goes through a `storedQuery` codec); Listings carries the applied view in `savedView` because its own `view` param is a mode switch.
- Orders is behind `VITE_OL_ORDERS_SAVED_VIEWS_ENABLED` (on by default).
- Search text is never saved in a view, server-side stripped.
- The prototype's sample data and state-control panels are not part of the product.

I could not compare every prototype state against the shipped UI; treat the Architecture tab as intent and `docs/frontend-architecture.md` § Saved list views as fact.
