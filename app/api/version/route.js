import * as store from '@/lib/store.mjs';

export const dynamic = 'force-dynamic';

export function GET(req) {
  const q = new URL(req.url).searchParams;
  try {
    const slug = q.get('p');
    const cid = q.get('c');
    return new Response(store.version(slug, cid ? store.getCommit(slug, cid) : null));
  } catch {
    return new Response('', { status: 404 });
  }
}
