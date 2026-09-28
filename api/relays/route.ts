import { collect, type Snapshot } from "@/lib/collect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Warm-instance cache; the CDN cache header below does the heavy lifting on Vercel.
let cache: { at: number; data: Snapshot } | null = null;
let inflight: Promise<Snapshot> | null = null;
const TTL_MS = 3 * 60 * 1000;

export async function GET() {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    inflight ??= collect().finally(() => (inflight = null));
    const data = await inflight;
    if (data.relays.length > 0) cache = { at: Date.now(), data };
    else if (!cache) return Response.json(data, { status: 503 });
  }
  return Response.json(cache!.data, {
    headers: { "Cache-Control": "public, s-maxage=180, stale-while-revalidate=600" },
  });
}
