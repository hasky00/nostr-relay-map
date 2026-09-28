"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MONITOR_RELAYS,
  ONLINE_WINDOW_SEC,
  isOnline,
  mergeRelay,
  parseEvent,
  type NostrEvent,
  type Relay,
} from "@/lib/nip66";

const RelayMap = dynamic(() => import("./RelayMap"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});

type Filter = "all" | "online" | "offline";
type FeedItem = { id: string; url: string; t: number; rtt?: number; country?: string };

export default function Dashboard() {
  const [relays, setRelays] = useState<Map<string, Relay>>(new Map());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const [liveCount, setLiveCount] = useState(0);
  const [connected, setConnected] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [pulse, setPulse] = useState<{ url: string; t: number } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const seenIds = useRef(new Set<string>());

  // 1) Snapshot from our API (30 days of monitor history, aggregated server-side).
  const loadSnapshot = useCallback(async () => {
    try {
      const res = await fetch("/api/relays");
      if (!res.ok) throw new Error(String(res.status));
      const data: { generatedAt: number; relays: Relay[] } = await res.json();
      setRelays((prev) => {
        const next = new Map(prev);
        for (const r of data.relays) {
          const cur = next.get(r.url);
          next.set(r.url, cur ? mergeRelay(cur, r) : r);
        }
        return next;
      });
      setSnapshotAt(data.generatedAt);
      setStatus("ready");
    } catch {
      setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  useEffect(() => {
    loadSnapshot();
    const id = setInterval(loadSnapshot, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadSnapshot]);

  // 2) Live: subscribe directly to monitor relays for new kind 30166 reports.
  useEffect(() => {
    const sockets: WebSocket[] = [];
    let stopped = false;
    const open = (url: string, attempt = 0) => {
      if (stopped) return;
      const ws = new WebSocket(url);
      sockets.push(ws);
      ws.onopen = () => {
        setConnected((c) => c + 1);
        ws.send(
          JSON.stringify(["REQ", "live", { kinds: [30166], since: Math.floor(Date.now() / 1000) - 60 }]),
        );
      };
      ws.onmessage = (m) => {
        let d: unknown[];
        try {
          d = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (d[0] !== "EVENT") return;
        const e = d[2] as NostrEvent;
        if (seenIds.current.has(e.id)) return;
        seenIds.current.add(e.id);
        const r = parseEvent(e);
        if (!r) return;
        setRelays((prev) => {
          const next = new Map(prev);
          const cur = next.get(r.url);
          next.set(r.url, cur ? mergeRelay(cur, { ...r, monitors: cur.monitors }) : r);
          return next;
        });
        setLiveCount((c) => c + 1);
        setPulse({ url: r.url, t: Date.now() });
        setFeed((f) =>
          [{ id: e.id, url: r.url, t: e.created_at, rtt: r.rttOpen, country: r.country }, ...f].slice(0, 40),
        );
      };
      ws.onclose = () => {
        setConnected((c) => Math.max(0, c - 1));
        if (!stopped) setTimeout(() => open(url, attempt + 1), Math.min(30000, 2000 * 2 ** attempt));
      };
      ws.onerror = () => ws.close();
    };
    MONITOR_RELAYS.forEach((u) => open(u));
    return () => {
      stopped = true;
      sockets.forEach((s) => s.close());
    };
  }, []);

  // Tick so "online" status ages out without a reload.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(id);
  }, []);

  const list = useMemo(() => [...relays.values()], [relays]);

  const stats = useMemo(() => {
    let online = 0,
      paid = 0,
      located = 0,
      hidden = 0;
    const countries = new Map<string, { name: string; on: number; total: number }>();
    for (const r of list) {
      const on = isOnline(r, now);
      if (on) online++;
      if (r.paid) paid++;
      if (r.lat !== undefined) located++;
      if (r.cdn) hidden++;
      if (r.country) {
        const c = countries.get(r.country) ?? { name: r.countryName ?? r.country, on: 0, total: 0 };
        c.total++;
        if (on) c.on++;
        countries.set(r.country, c);
      }
    }
    const top = [...countries.entries()].sort((a, b) => b[1].on - a[1].on || b[1].total - a[1].total);
    return { total: list.length, online, offline: list.length - online, paid, located, hidden, countries: top };
  }, [list, now]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((r) => {
        const on = isOnline(r, now);
        if (filter === "online" && !on) return false;
        if (filter === "offline" && on) return false;
        if (q && !r.url.includes(q) && !(r.countryName ?? "").toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }, [list, filter, query, now]);

  const sel = selected ? relays.get(selected) : undefined;
  const maxCountry = stats.countries[0]?.[1].on || 1;

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M2 12h20M12 2c3 3.5 3 16.5 0 20M12 2c-3 3.5-3 16.5 0 20" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </span>
          <div>
            <h1>Nostr Relay Map</h1>
            <p className="sub">Live health of the relay network, from NIP-66 monitors</p>
          </div>
        </div>
        <div className={`live ${connected > 0 ? "on" : ""}`} title={`${connected} monitor feeds connected`}>
          <span className="dot" />
          {connected > 0 ? "LIVE" : "connecting"}
          <span className="muted"> · {liveCount} reports</span>
        </div>
      </header>

      <section className="stats">
        <Stat label="Known relays" value={stats.total} hint="seen by a monitor in last 30 days" loading={status === "loading"} />
        <Stat label="Online" value={stats.online} tone="on" hint={`reached in last ${ONLINE_WINDOW_SEC / 3600}h`} loading={status === "loading"} />
        <Stat label="Offline" value={stats.offline} tone="off" hint="known, but not reached recently" loading={status === "loading"} />
        <Stat label="Countries" value={stats.countries.length} hint={`${stats.located} on the map · ${stats.hidden} hidden by Cloudflare`} loading={status === "loading"} />
        <Stat label="Paid relays" value={stats.paid} hint="require payment to write" loading={status === "loading"} />
      </section>

      {status === "error" && (
        <div className="banner">Couldn’t load the snapshot. Live reports will still fill the map as they arrive.</div>
      )}

      <main className="grid">
        <div className="mapwrap">
          <RelayMap relays={visible} pulse={pulse} focus={selected} onSelect={setSelected} />
          <div className="legend">
            <span><i className="sw on" /> online</span>
            <span><i className="sw off" /> offline</span>
            <span><i className="sw flash" /> live report</span>
          </div>
          {sel && <Detail r={sel} now={now} onClose={() => setSelected(null)} />}
        </div>

        <aside className="side">
          <div className="panel">
            <div className="tabs" role="tablist">
              {(["all", "online", "offline"] as Filter[]).map((f) => (
                <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "act" : ""} onClick={() => setFilter(f)}>
                  {f} <span className="n">{f === "all" ? stats.total : f === "online" ? stats.online : stats.offline}</span>
                </button>
              ))}
            </div>
            <input
              className="search"
              placeholder="Search relay or country…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="rlist">
              {visible.slice(0, 150).map((r) => {
                const on = isOnline(r, now);
                return (
                  <li key={r.url} className={selected === r.url ? "sel" : ""} onClick={() => setSelected(r.url)}>
                    <i className={`sw ${on ? "on" : "off"}`} />
                    <span className="u">{r.url.replace(/^wss?:\/\//, "")}</span>
                    <span className="meta">
                      {r.country ?? (r.cdn ? "CF" : "··")} · {ago(now - r.lastSeen)}
                    </span>
                  </li>
                );
              })}
              {visible.length > 150 && <li className="more">+{visible.length - 150} more — refine your search</li>}
              {visible.length === 0 && status !== "loading" && <li className="more">No relays match.</li>}
            </ul>
          </div>

          <div className="panel">
            <h2>Top countries <span className="muted">online / known</span></h2>
            <ul className="bars">
              {stats.countries.slice(0, 10).map(([code, c]) => (
                <li key={code} onClick={() => setQuery(c.name)}>
                  <span className="cn">{c.name}</span>
                  <span className="bar"><span style={{ width: `${(c.on / maxCountry) * 100}%` }} /></span>
                  <span className="num">{c.on}<span className="muted">/{c.total}</span></span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel">
            <h2>Live monitor feed</h2>
            <ul className="feed">
              {feed.length === 0 && <li className="muted">Waiting for the next check… monitors report every few seconds to minutes.</li>}
              {feed.map((f) => (
                <li key={f.id} onClick={() => setSelected(f.url)}>
                  <i className="sw on" />
                  <span className="u">{f.url.replace(/^wss?:\/\//, "")}</span>
                  <span className="meta">{f.rtt ? `${f.rtt}ms` : ""} {f.country ?? ""}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>

      <footer className="foot">
        Relays behind Cloudflare share IP addresses worldwide, so their server location can’t be known and they are left off the map.{" "}
        Data: NIP-66 kind 30166 reports from {MONITOR_RELAYS.map((u) => u.replace("wss://", "")).join(", ")}.
        {snapshotAt && <> Snapshot {ago(now - snapshotAt)} ago.</>} “Online” means a monitor reached it in the last{" "}
        {ONLINE_WINDOW_SEC / 3600} hours.
      </footer>
    </div>
  );
}

function Stat({ label, value, hint, tone, loading }: { label: string; value: number; hint: string; tone?: "on" | "off"; loading?: boolean }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="lbl">{label}</div>
      <div className="val">{loading ? "—" : value.toLocaleString()}</div>
      <div className="hint">{hint}</div>
    </div>
  );
}

function Detail({ r, now, onClose }: { r: Relay; now: number; onClose: () => void }) {
  const on = isOnline(r, now);
  return (
    <div className="detail">
      <button className="x" onClick={onClose} aria-label="Close">×</button>
      <div className={`badge ${on ? "on" : "off"}`}>{on ? "ONLINE" : "OFFLINE"}</div>
      <h3>{r.url}</h3>
      <dl>
        <dt>Last seen</dt><dd>{ago(now - r.lastSeen)} ago</dd>
        <dt>Location</dt>
        <dd>
          {r.countryName ?? r.country ?? "unknown"}
          {r.countryEstimated && " (guessed from domain)"}
          {r.cdn && ` · behind ${r.cdn}, real server location hidden`}
        </dd>
        <dt>Latency</dt><dd>{r.rttOpen ? `open ${r.rttOpen}ms` : "—"}{r.rttRead ? ` · read ${r.rttRead}ms` : ""}</dd>
        <dt>Software</dt><dd>{r.software ?? "—"}</dd>
        <dt>Host</dt><dd>{r.isp ?? "—"}</dd>
        <dt>Access</dt><dd>{r.paid ? "paid" : r.paid === false ? "free" : "?"} · {r.auth ? "auth required" : r.auth === false ? "no auth" : "auth ?"}</dd>
        <dt>Monitors</dt><dd>{r.monitors}</dd>
        <dt>NIPs</dt><dd className="nips">{r.nips.length ? r.nips.join(", ") : "—"}</dd>
      </dl>
    </div>
  );
}

function ago(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}
