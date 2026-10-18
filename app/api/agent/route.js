import * as store from '@/lib/store.mjs';

export const dynamic = 'force-dynamic';

export function GET(req) {
  try {
    return Response.json(store.agentStatus(new URL(req.url).searchParams.get('p')));
  } catch {
    return Response.json({ state: 'off', at: null }, { status: 404 });
  }
}
