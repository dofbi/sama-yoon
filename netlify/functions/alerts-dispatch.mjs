// Scheduled every 10 minutes: sends the push alerts that are due.
// (Netlify scheduled functions are not reachable by URL in production; use
// alerts-admin for previews.)
import { dispatch } from '../lib/dispatch.mjs';
import { assertConfigured } from '../lib/push-backend.mjs';

export default async () => {
  try {
    assertConfigured();
    const r = await dispatch(new Date());
    console.log(JSON.stringify({ due: r.due.length, sent: r.sent }));
  } catch (e) {
    console.error('alerts-dispatch failed', e.message);
  }
  return new Response('ok');
};

export const config = { schedule: '*/10 * * * *' };
