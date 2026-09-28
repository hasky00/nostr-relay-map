"use client";

import { useEffect, useRef } from "react";
import type { Map as LMap, CircleMarker, Renderer } from "leaflet";
import { isOnline, type Relay } from "@/lib/nip66";

type Props = {
  relays: Relay[];
  pulse: { url: string; t: number } | null;
  focus: string | null;
  onSelect: (url: string) => void;
};

const ON = "#3ddc97";
const OFF = "#ff5c7a";

export default function RelayMap({ relays, pulse, focus, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const markers = useRef(new Map<string, CircleMarker>());
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(el.current, {
        center: [30, 10],
        zoom: 2,
        minZoom: 1,
        maxZoom: 10,
        worldCopyJump: true,
        preferCanvas: true,
        zoomControl: true,
        attributionControl: true,
      });
      // Self-hosted country outlines: no tile server, no API key, nothing to break.
      const [{ feature }, topo] = await Promise.all([
        import("topojson-client"),
        import("world-atlas/countries-50m.json"),
      ]);
      if (cancelled) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = (topo as any).default ?? topo;
      const countries = feature(t, t.objects.countries);
      L.geoJSON(countries, {
        interactive: false,
        style: { color: "#2a3346", weight: 0.7, fillColor: "#161c29", fillOpacity: 1 },
      }).addTo(map);
      map.attributionControl.addAttribution("Natural Earth · data: NIP-66 monitors");
      if (el.current.clientWidth < 700) map.setView([25, 0], 1);
      rendererRef.current = L.canvas({ padding: 0.5 });
      mapRef.current = map;
      drawAll();
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const relaysRef = useRef(relays);
  relaysRef.current = relays;

  function drawAll() {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const now = Date.now() / 1000;
    const seen = new Set<string>();
    for (const r of relaysRef.current) {
      if (r.lat === undefined || r.lon === undefined) continue;
      seen.add(r.url);
      const online = isOnline(r, now);
      const color = online ? ON : OFF;
      let m = markers.current.get(r.url);
      if (!m) {
        const j = hashJitter(r.url);
        m = L.circleMarker([r.lat + j[0], r.lon + j[1]], {
          renderer: rendererRef.current!,
          radius: 4,
          weight: 1,
          color,
          fillColor: color,
          fillOpacity: online ? 0.75 : 0.35,
          opacity: online ? 0.9 : 0.5,
        });
        m.on("click", () => selectRef.current(r.url));
        m.bindTooltip(r.url.replace(/^wss?:\/\//, ""), { direction: "top", offset: [0, -4] });
        m.addTo(map);
        markers.current.set(r.url, m);
      } else {
        m.setStyle({ color, fillColor: color, fillOpacity: online ? 0.75 : 0.35, opacity: online ? 0.9 : 0.5 });
      }
    }
    for (const [url, m] of markers.current) {
      if (!seen.has(url)) {
        m.remove();
        markers.current.delete(url);
      }
    }
  }

  useEffect(drawAll, [relays]);

  useEffect(() => {
    if (!pulse) return;
    const m = markers.current.get(pulse.url);
    if (!m) return;
    m.setRadius(10);
    m.setStyle({ weight: 3, color: "#ffffff" });
    m.bringToFront();
    const id = setTimeout(() => {
      m.setRadius(4);
      m.setStyle({ weight: 1, color: ON });
    }, 900);
    return () => clearTimeout(id);
  }, [pulse]);

  useEffect(() => {
    if (!focus) return;
    const m = markers.current.get(focus);
    const map = mapRef.current;
    if (m && map) {
      map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 5), { duration: 0.8 });
      m.openTooltip();
    }
  }, [focus]);

  return <div ref={el} className="map" aria-label="World map of Nostr relays" />;
}

function hashJitter(s: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  const a = ((h & 0xffff) / 0xffff - 0.5) * 0.35;
  const b = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 0.35;
  return [a, b];
}
