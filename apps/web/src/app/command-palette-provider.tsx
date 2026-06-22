/**
 * CommandPaletteProvider
 *
 * Wires the global ⌘K command palette for authenticated sessions. Provides:
 * - Global keyboard shortcut (⌘K / Ctrl+K) to open/close the palette
 * - Five result sources: Navigation, Connections, Orders, Products, Sync Jobs
 * - Recent-selections persistence to localStorage (`ol:palette:recent`)
 * - Recents cleared on logout (when session status transitions to 'anonymous')
 *
 * Data queries fire at mount inside the authenticated shell and are served
 * from TanStack Query's cache on subsequent opens. Client-side substring
 * filtering is applied because the Orders and SyncJobs list APIs do not
 * expose a `search` parameter.
 *
 * @module app
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useConnectionsQuery } from '../features/connections/hooks/use-connections-query';
import { useOrdersQuery } from '../features/orders/hooks/use-orders-query';
import { useProductsQuery } from '../features/products/hooks/use-products-query';
import { useSyncJobsQuery } from '../features/sync-jobs/hooks/use-sync-jobs-query';
import { useDebouncedValue } from '../shared/hooks/use-debounced-value';
import { CommandPalette } from '../shared/ui/command-palette';
import type { PaletteGroup, PaletteItem } from '../shared/ui/command-palette';
import { useSession } from '../shared/auth/use-session';
import { BASE_NAV_GROUPS } from './nav-registry';
import type { LiveNavGroup } from './nav-registry.types';

// ── Recents ──────────────────────────────────────────────────────────

const RECENTS_KEY = 'ol:palette:recent';
const MAX_RECENTS = 5;

interface RecentEntry {
  id: string;
  label: string;
  to: string;
  description?: string;
}

function loadRecents(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentEntry[];
  } catch {
    return [];
  }
}

function saveRecents(entries: RecentEntry[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(entries));
  } catch {
    // storage quota exceeded or private mode — silently ignore
  }
}

function clearRecents(): void {
  try {
    localStorage.removeItem(RECENTS_KEY);
  } catch {
    // ignore
  }
}

function pushRecent(entry: RecentEntry, current: RecentEntry[]): RecentEntry[] {
  const deduped = current.filter((r) => r.id !== entry.id);
  return [entry, ...deduped].slice(0, MAX_RECENTS);
}

// ── Context ───────────────────────────────────────────────────────────

interface CommandPaletteContextValue {
  open: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error('useCommandPalette must be used inside CommandPaletteProvider');
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────

export function CommandPaletteProvider({ children }: PropsWithChildren): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<RecentEntry[]>(() => loadRecents());
  const navigate = useNavigate();
  const { session } = useSession();
  const prevStatusRef = useRef(session.status);

  // Clear recents on logout.
  useEffect(() => {
    if (prevStatusRef.current === 'authenticated' && session.status === 'anonymous') {
      clearRecents();
      setRecents([]);
    }
    prevStatusRef.current = session.status;
  }, [session.status]);

  // Global ⌘K / Ctrl+K shortcut.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setIsOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Reset query when palette closes.
  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  // ── Select handler — defined before memos so it can be in their dep arrays ──

  const handleSelect = useCallback(
    (entry: RecentEntry, isRecentClick = false): void => {
      if (!isRecentClick) {
        const next = pushRecent(entry, recents);
        setRecents(next);
        saveRecents(next);
      }
      setIsOpen(false);
      void navigate(entry.to);
    },
    [navigate, recents],
  );

  // ── Data queries (unconditional — served from TanStack Query cache) ──

  const debouncedQuery = useDebouncedValue(query, 300);
  const searchTerm = debouncedQuery.toLowerCase();

  const connectionsQuery = useConnectionsQuery();
  const ordersQuery = useOrdersQuery(undefined, { limit: 20 });
  const productsQuery = useProductsQuery(
    searchTerm.length >= 2 ? { search: debouncedQuery } : undefined,
    { limit: 10 },
  );
  const syncJobsQuery = useSyncJobsQuery(undefined, { limit: 20 });

  // ── Navigation source ─────────────────────────────────────────────

  const navItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];
    for (const group of BASE_NAV_GROUPS) {
      if (group.kind !== 'live') continue;
      const liveGroup = group as LiveNavGroup;
      for (const item of liveGroup.items) {
        if (
          searchTerm.length === 0 ||
          item.label.toLowerCase().includes(searchTerm) ||
          item.to.toLowerCase().includes(searchTerm)
        ) {
          items.push({
            id: 'nav:' + item.to,
            label: item.label,
            description: item.to,
            onSelect: () =>
              handleSelect({ id: 'nav:' + item.to, label: item.label, to: item.to }),
          });
        }
      }
    }
    return items;
  }, [searchTerm, handleSelect]);

  // ── Connection source ─────────────────────────────────────────────

  const connectionItems = useMemo<PaletteItem[]>(() => {
    const conns = connectionsQuery.data ?? [];
    return conns
      .filter(
        (c) =>
          searchTerm.length === 0 ||
          c.name.toLowerCase().includes(searchTerm) ||
          c.platformType.toLowerCase().includes(searchTerm),
      )
      .slice(0, 5)
      .map((c) => ({
        id: 'conn:' + c.id,
        label: c.name,
        description: c.platformType,
        onSelect: () =>
          handleSelect({
            id: 'conn:' + c.id,
            label: c.name,
            to: '/connections/' + c.id,
            description: c.platformType,
          }),
      }));
  }, [connectionsQuery.data, searchTerm, handleSelect]);

  // ── Order source ──────────────────────────────────────────────────

  const orderItems = useMemo<PaletteItem[]>(() => {
    const orders = ordersQuery.data?.items ?? [];
    return orders
      .filter((o) => {
        if (searchTerm.length === 0) return true;
        const label = o.syncStatus[0]?.externalOrderNumber ?? o.internalOrderId;
        return label.toLowerCase().includes(searchTerm);
      })
      .slice(0, 5)
      .map((o) => {
        const label = o.syncStatus[0]?.externalOrderNumber ?? o.internalOrderId;
        const description = String(o.syncStatus[0]?.status ?? o.recordStatus);
        return {
          id: 'order:' + o.internalOrderId,
          label,
          description,
          onSelect: () =>
            handleSelect({
              id: 'order:' + o.internalOrderId,
              label,
              to: '/orders/' + o.internalOrderId,
              description,
            }),
        };
      });
  }, [ordersQuery.data, searchTerm, handleSelect]);

  // ── Product source ────────────────────────────────────────────────

  const productItems = useMemo<PaletteItem[]>(() => {
    const products = productsQuery.data?.items ?? [];
    return products.slice(0, 5).map((p) => ({
      id: 'product:' + p.id,
      label: p.name,
      description: p.sku ?? undefined,
      onSelect: () =>
        handleSelect({
          id: 'product:' + p.id,
          label: p.name,
          to: '/products/' + p.id,
          description: p.sku ?? undefined,
        }),
    }));
  }, [productsQuery.data, handleSelect]);

  // ── Sync job source ───────────────────────────────────────────────

  const syncJobItems = useMemo<PaletteItem[]>(() => {
    const jobs = syncJobsQuery.data?.items ?? [];
    return jobs
      .filter((j) => {
        if (searchTerm.length === 0) return true;
        return (
          j.jobType.toLowerCase().includes(searchTerm) ||
          j.id.toLowerCase().includes(searchTerm)
        );
      })
      .slice(0, 5)
      .map((j) => ({
        id: 'job:' + j.id,
        label: j.jobType,
        description: j.status,
        onSelect: () =>
          handleSelect({
            id: 'job:' + j.id,
            label: j.jobType,
            to: '/jobs-logs/' + j.id,
            description: j.status,
          }),
      }));
  }, [syncJobsQuery.data, searchTerm, handleSelect]);

  // ── Recent source ─────────────────────────────────────────────────

  const recentItems = useMemo<PaletteItem[]>(() => {
    if (searchTerm.length > 0) return [];
    return recents.map((r) => ({
      id: 'recent:' + r.id,
      label: r.label,
      description: r.description,
      onSelect: () => handleSelect(r, true),
    }));
  }, [recents, searchTerm, handleSelect]);

  // ── Groups assembly ───────────────────────────────────────────────

  const groups = useMemo<PaletteGroup[]>(() => {
    const out: PaletteGroup[] = [];
    if (recentItems.length > 0)
      out.push({ key: 'recents', heading: 'Recent', items: recentItems });
    if (navItems.length > 0) out.push({ key: 'nav', heading: 'Navigation', items: navItems });
    if (connectionItems.length > 0)
      out.push({ key: 'connections', heading: 'Connections', items: connectionItems });
    if (orderItems.length > 0)
      out.push({ key: 'orders', heading: 'Orders', items: orderItems });
    if (productItems.length > 0)
      out.push({ key: 'products', heading: 'Products', items: productItems });
    if (syncJobItems.length > 0)
      out.push({ key: 'jobs', heading: 'Jobs', items: syncJobItems });
    return out;
  }, [recentItems, navItems, connectionItems, orderItems, productItems, syncJobItems]);

  const isLoading =
    connectionsQuery.isLoading ||
    ordersQuery.isLoading ||
    productsQuery.isFetching ||
    syncJobsQuery.isLoading;

  const ctx = useMemo<CommandPaletteContextValue>(() => ({ open: () => setIsOpen(true) }), []);

  return (
    <CommandPaletteContext.Provider value={ctx}>
      {children}
      <CommandPalette
        open={isOpen}
        onOpenChange={setIsOpen}
        query={query}
        onQueryChange={setQuery}
        groups={groups}
        loading={isLoading && groups.length === 0}
      />
    </CommandPaletteContext.Provider>
  );
}
