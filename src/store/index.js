// Picks the backend (Supabase when configured, local demo otherwise) and adds
// an offline queue: reports created without network are kept in localStorage
// and flushed when the browser comes back online.
import { createMockStore } from './mock.js';

const QUEUE_KEY = 'samayoon.outbox';
const RATE_KEY = 'samayoon.lastReportAt';
export const REPORT_COOLDOWN_MS = 2 * 60 * 1000;

const safeGet = (k, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? fallback;
  } catch {
    return fallback;
  }
};
const safeSet = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

export async function createStore() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  let backend;
  if (url && key) {
    const { createSupabaseStore } = await import('./supabase.js');
    backend = createSupabaseStore(url, key);
  } else {
    backend = createMockStore();
  }

  async function flush() {
    const queue = safeGet(QUEUE_KEY, []);
    if (!queue.length || !navigator.onLine) return;
    const remaining = [];
    for (const item of queue) {
      try {
        await backend.create(item);
      } catch {
        remaining.push(item);
      }
    }
    safeSet(QUEUE_KEY, remaining);
  }
  addEventListener('online', flush);
  flush();

  return {
    mode: backend.mode,
    list: () => backend.list(),
    upvote: (id) => backend.upvote(id),
    subscribe: (cb) => backend.subscribe(cb),
    // Client-side throttle only; the real guard is server-side (see schema.sql).
    cooldownRemainingMs() {
      return Math.max(0, safeGet(RATE_KEY, 0) + REPORT_COOLDOWN_MS - Date.now());
    },
    async create(report) {
      safeSet(RATE_KEY, Date.now());
      if (!navigator.onLine && backend.mode !== 'mock') {
        safeSet(QUEUE_KEY, [...safeGet(QUEUE_KEY, []), report]);
        return { queued: true };
      }
      return { queued: false, report: await backend.create(report) };
    },
  };
}
