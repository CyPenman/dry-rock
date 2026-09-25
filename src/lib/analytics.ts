// Anonymous usage counts through GoatCounter (https://ukdryrock.goatcounter.com).
// index.html loads count.js, which counts each app open as a pageview on its
// own - no cookies, nothing stored on the phone. Screens inside the app are not
// separate URLs, so opening a crag, tab or overlay is counted here as an event.
// Both are skipped quietly when count.js hasn't loaded (offline, blocked by a
// tracker blocker, or still loading) and on localhost.

interface GoatCounter {
  count?: (vars: { path: string; title?: string; event?: boolean }) => void;
}

declare global {
  interface Window {
    goatcounter?: GoatCounter;
  }
}

export function countEvent(path: string, title?: string): void {
  try {
    window.goatcounter?.count?.({ path, title, event: true });
  } catch {
    // Counting must never break the app.
  }
}
