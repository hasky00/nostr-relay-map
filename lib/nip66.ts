// NIP-66 relay discovery (kind 30166) parsing — shared by server and client.

export type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
};

export type Relay = {
  url: string;
  lastSeen: number; // unix seconds of newest monitor report
  lat?: number;
  lon?: number;
  country?: string; // ISO-2
  countryName?: string;
  network?: string; // clearnet | tor | i2p
  rttOpen?: number;
  rttRead?: number;
  software?: string;
  isp?: string;
  nips: number[];
  paid?: boolean;
  auth?: boolean;
  monitors: number; // distinct monitors that reported it
  cdn?: string; // e.g. "Cloudflare": IP geolocation is meaningless, real location hidden
  countryEstimated?: boolean; // country guessed from the domain ending, not the server IP
};

export const MONITOR_RELAYS = [
  "wss://relaypag.es",
  "wss://relay.nostr.watch",
  "wss://monitorlizard.nostr1.com",
];

/** A relay is "online" if a monitor reached it within this window. */
export const ONLINE_WINDOW_SEC = 2 * 60 * 60;
/** Relays reported at least once in this window count as "known". */
export const KNOWN_WINDOW_SEC = 30 * 24 * 60 * 60;

const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function decodeGeohash(hash: string): { lat: number; lon: number } | null {
  let even = true;
  const lat: [number, number] = [-90, 90];
  const lon: [number, number] = [-180, 180];
  for (const ch of hash.toLowerCase()) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const b = (v >> bit) & 1;
      const r = even ? lon : lat;
      const mid = (r[0] + r[1]) / 2;
      if (b) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 };
}

export function normalizeUrl(u: string): string {
  return u.trim().replace(/\/+$/, "").toLowerCase();
}

export function parseEvent(e: NostrEvent): Relay | null {
  const d = e.tags.find((t) => t[0] === "d")?.[1];
  if (!d || !/^wss?:\/\//i.test(d)) return null;
  const r: Relay = { url: normalizeUrl(d), lastSeen: e.created_at, nips: [], monitors: 1 };
  let bestGeo = "";
  for (const t of e.tags) {
    const [k, v, ns] = t;
    if (v === undefined) continue;
    switch (k) {
      case "g":
        if (v.length > bestGeo.length) bestGeo = v;
        break;
      case "n":
        r.network = v;
        break;
      case "rtt-open":
        r.rttOpen = Number(v) || undefined;
        break;
      case "rtt-read":
        r.rttRead = Number(v) || undefined;
        break;
      case "N": {
        const n = Number(v);
        if (Number.isFinite(n) && !r.nips.includes(n)) r.nips.push(n);
        break;
      }
      case "R":
        if (v === "payment") r.paid = true;
        else if (v === "!payment") r.paid = false;
        else if (v === "auth") r.auth = true;
        else if (v === "!auth") r.auth = false;
        break;
      case "s":
        r.software = prettySoftware(v);
        break;
      case "l":
        if (ns === "countryCode" && v.length === 2) r.country = v.toUpperCase();
        else if (ns === "countryName") r.countryName = v;
        else if (ns === "host.isp") r.isp = v;
        break;
    }
  }
  if (r.isp && /cloudflare/i.test(r.isp)) {
    // Cloudflare's shared anycast IPs geolocate to Canada, so the monitor's
    // country and geohash say nothing about where the relay really runs.
    r.cdn = "Cloudflare";
    bestGeo = "";
    r.country = undefined;
    r.countryName = undefined;
  }
  if (bestGeo) {
    const p = decodeGeohash(bestGeo);
    if (p) {
      r.lat = p.lat;
      r.lon = p.lon;
    }
  }
  if (!r.country) {
    const est = countryFromDomain(r.url);
    if (est) {
      r.country = est.code;
      r.countryName = est.name;
      r.countryEstimated = true;
    }
  }
  r.nips.sort((a, b) => a - b);
  return r;
}

// Two-letter domain endings that are used worldwide as generic names, so they
// say nothing about the country (e.g. .io, .me, .co, .ai).
const GENERIC_CCTLDS = new Set(
  "io co me tv ai gg sh fm to ws cc la ly im nu so st vc ag am bz cx cm gl gs ms nf pw sc tk ml ga cf gq cd tc vg mu".split(" "),
);
let regionNames: Intl.DisplayNames | null = null;

export function countryFromDomain(url: string): { code: string; name: string } | null {
  let host: string;
  try {
    host = new URL(url.replace(/^ws/, "http")).hostname;
  } catch {
    return null;
  }
  const tld = host.split(".").pop() ?? "";
  if (!/^[a-z]{2}$/.test(tld) || GENERIC_CCTLDS.has(tld)) return null;
  const code = (tld === "uk" ? "gb" : tld).toUpperCase();
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    const name = regionNames.of(code);
    if (!name || name === code) return null;
    return { code, name };
  } catch {
    return null;
  }
}

function prettySoftware(s: string): string {
  const m = s.match(/([^/]+?)(?:\.git)?\/?$/);
  return m ? m[1] : s;
}

/** Merge a newer/older report into an existing record, keeping the freshest status
 *  and filling in any fields the other report lacked. */
export function mergeRelay(a: Relay, b: Relay): Relay {
  const [newer, older] = a.lastSeen >= b.lastSeen ? [a, b] : [b, a];
  const out: Relay = { ...older, ...stripUndefined(newer) };
  out.nips = newer.nips.length ? newer.nips : older.nips;
  out.monitors = Math.max(a.monitors, b.monitors);
  return out;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const r: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (r as Record<string, unknown>)[k] = v;
  return r;
}

export function isOnline(r: Relay, now = Date.now() / 1000): boolean {
  return now - r.lastSeen < ONLINE_WINDOW_SEC;
}
