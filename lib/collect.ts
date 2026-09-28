import {
  KNOWN_WINDOW_SEC,
  MONITOR_RELAYS,
  mergeRelay,
  parseEvent,
  type NostrEvent,
  type Relay,
} from "./nip66";

type Acc = Map<string, { relay: Relay; monitors: Set<string> }>;

/** Page backwards through one monitor relay's kind 30166 history. */
function pull(url: string, since: number, acc: Acc, deadline: number): Promise<number> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    let events = 0;
    let round = 0;
    let got = 0;
    let until = Math.floor(Date.now() / 1000);
    let minT = until;
    const finish = () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      resolve(events);
    };
    const timer = setTimeout(finish, Math.max(1000, deadline - Date.now()));
    const req = () =>
      ws.send(JSON.stringify(["REQ", `m${round}`, { kinds: [30166], since, until, limit: 5000 }]));
    try {
      ws = new WebSocket(url);
    } catch {
      return resolve(0);
    }
    ws.onopen = req;
    ws.onerror = finish;
    ws.onmessage = (msg) => {
      let d: unknown[];
      try {
        d = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      if (d[0] === "EVENT") {
        const e = d[2] as NostrEvent;
        got++;
        events++;
        if (e.created_at < minT) minT = e.created_at;
        const r = parseEvent(e);
        if (!r) return;
        const cur = acc.get(r.url);
        if (cur) {
          cur.relay = mergeRelay(cur.relay, r);
          cur.monitors.add(e.pubkey);
        } else acc.set(r.url, { relay: r, monitors: new Set([e.pubkey]) });
      } else if (d[0] === "EOSE" || d[0] === "CLOSED") {
        try {
          ws.send(JSON.stringify(["CLOSE", `m${round}`]));
        } catch {}
        round++;
        if (got < 50 || round >= 15 || Date.now() > deadline) return finish();
        until = minT - 1;
        got = 0;
        req();
      }
    };
  });
}

export type Snapshot = {
  generatedAt: number;
  sources: { url: string; events: number }[];
  relays: Relay[];
};

export async function collect(timeoutMs = 25_000): Promise<Snapshot> {
  const since = Math.floor(Date.now() / 1000) - KNOWN_WINDOW_SEC;
  const deadline = Date.now() + timeoutMs;
  const acc: Acc = new Map();
  const counts = await Promise.all(MONITOR_RELAYS.map((u) => pull(u, since, acc, deadline)));
  const relays = [...acc.values()].map(({ relay, monitors }) => ({ ...relay, monitors: monitors.size }));
  return {
    generatedAt: Math.floor(Date.now() / 1000),
    sources: MONITOR_RELAYS.map((url, i) => ({ url, events: counts[i] })),
    relays,
  };
}
