/**
 * Memu service worker — installability baseline.
 *
 * Chrome's PWA install heuristic requires a registered service worker
 * with a `fetch` handler. This SW is a pure pass-through: it doesn't
 * cache anything, doesn't intercept anything for offline use, doesn't
 * do background sync. Its only job is to exist + answer the fetch
 * event so Chrome offers the "Install Memu" prompt.
 *
 * Why pass-through and not offline-cached:
 *   - Memu's API responses are tenant-scoped + RLS-gated; caching them
 *     in the SW would cross workspaces in unpredictable ways.
 *   - The HTML shell is small enough that cold-loads on a tab refresh
 *     are not the bottleneck.
 *   - Offline-first is a separate slice with its own design questions
 *     (which tabs work offline, what writes get queued, how do we
 *     reconcile on reconnect). Premature here.
 *
 * Upgrade path when offline becomes a real product story:
 *   - Cache the app shell (HTML / CSS / JS / icons) on install
 *   - Network-first for /api/* (workspace-scoped data — never cache)
 *   - Stale-while-revalidate for /assets/* + /fonts/*
 *   - Background sync queue for offline writes (separate spec)
 */

self.addEventListener('install', () => {
  // Activate immediately on first registration so the install prompt
  // can fire without waiting for the next tab navigation.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Claim every open client (existing tabs of the PWA) so they
  // see the SW immediately on first activation.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pure pass-through. The fetch handler must exist for Chrome's
  // installability heuristic, but we deliberately don't intervene.
  event.respondWith(fetch(event.request));
});
