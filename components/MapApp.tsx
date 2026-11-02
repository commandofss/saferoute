"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/lib/supabase";
import InstallButton from "@/components/InstallButton";
import AlertPanel from "@/components/AlertPanel";
import { latLngToUtm, utmToLatLng, zoneOf } from "@/lib/coords";

const RADIUS_M = 100; // reports within 100 m count as the same point (also set in the database)
const START: [number, number] = [8.4966, 4.5421]; // Ilorin (change if you like)

const CATEGORIES: Record<string, string> = {
  sexual_assault: "Rape / sexual assault",
  kidnapping: "Kidnapping / attempted abduction",
  physical_assault: "Physical assault / attack",
  robbery: "Robbery / phone snatching",
  theft: "Theft",
  harassment: "Harassment / catcalling",
  stalking: "Stalking / being followed",
  gang_activity: "Gang or cult activity",
  unsafe_transport: "Unsafe transport",
  poor_lighting: "Poor lighting",
  isolated_road: "Isolated road",
  blocked_path: "Blocked path",
  other: "Other",
};

const ALL_KEYS = Object.keys(CATEGORIES);
const SERIOUS = ["sexual_assault", "kidnapping", "physical_assault", "robbery"];

// For these, no note is collected and severity is always "Dangerous", to protect people's privacy
const SENSITIVE = new Set(["sexual_assault", "kidnapping", "physical_assault"]);

// RUQAYAH: adjust these colour bands once the scoring is tuned
function colour(score: number) {
  if (score >= 10) return "#b91c1c";
  if (score >= 5) return "#ea580c";
  if (score >= 2) return "#f59e0b";
  return "#facc15";
}

function deviceToken() {
  try {
    let t = localStorage.getItem("sr_token");
    if (!t) {
      t = crypto.randomUUID();
      localStorage.setItem("sr_token", t);
    }
    return t;
  } catch {
    return crypto.randomUUID();
  }
}

type Pt = {
  pt_id: string;
  pt_lat: number;
  pt_lng: number;
  report_count: number;
  risk_score: number;
  top_category: string;
};

function distM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

export default function MapApp() {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pin = useRef<L.CircleMarker | null>(null);

  const [nightOnly, setNightOnly] = useState(false);
  const nightRef = useRef(false);
  nightRef.current = nightOnly;

  const [shown, setShown] = useState<string[]>(ALL_KEYS);
  const shownRef = useRef<string[]>(ALL_KEYS);
  shownRef.current = shown;
  const toggle = (k: string) => setShown((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const [pts, setPts] = useState<Pt[]>([]);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [coordMode, setCoordMode] = useState<"latlng" | "utm">("latlng");
  const [c1, setC1] = useState(""); // latitude, or easting
  const [c2, setC2] = useState(""); // longitude, or northing
  const [zone, setZone] = useState("31");
  const [form, setForm] = useState({
    category: "poor_lighting",
    severity: 2,
    time_of_day: "night",
    description: "",
  });

  const sensitive = SENSITIVE.has(form.category);

  const choose = useCallback((lat: number, lng: number) => {
    if (!map.current) return;
    setPicked({ lat, lng });
    pin.current?.remove();
    pin.current = L.circleMarker([lat, lng], { radius: 8, color: "#6d28d9", fillOpacity: 0.9, className: "pin" }).addTo(map.current);
  }, []);

  const load = useCallback(async () => {
    if (!map.current) return;
    const b = map.current.getBounds();
    const { data, error } = await supabase.rpc("risk_points", {
      min_lat: b.getSouth(),
      min_lng: b.getWest(),
      max_lat: b.getNorth(),
      max_lng: b.getEast(),
      only_evening_night: nightRef.current,
      only_categories: shownRef.current.length === ALL_KEYS.length ? null : shownRef.current,
    });
    if (error) {
      setMsg("Could not load the risk map: " + error.message);
      return;
    }
    setPts((data as Pt[]) || []);
  }, []);

  // draw one 100 m circle per point
  useEffect(() => {
    if (!layer.current) return;
    layer.current.clearLayers();
    pts.forEach((p) => {
      L.circle([p.pt_lat, p.pt_lng], {
        radius: RADIUS_M,
        color: colour(p.risk_score),
        weight: 1,
        fillOpacity: 0.45,
        className: p.risk_score >= 10 ? "pulse" : "",
      })
        .bindPopup(
          `${p.report_count} report(s) at this point<br/>Main issue: ${CATEGORIES[p.top_category] ?? p.top_category}<br/>Risk score ${p.risk_score.toFixed(1)}`
        )
        .addTo(layer.current!);
    });
  }, [pts]);

  useEffect(() => {
    if (!mapEl.current || map.current) return;
    const m = L.map(mapEl.current).setView(START, 16);
    // Base maps: street, satellite, and satellite with place names (switch with the button on the map)
    const street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    });
    const esriAttribution = "Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community";
    const satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, maxNativeZoom: 18, attribution: esriAttribution }
    );
    const labels = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, maxNativeZoom: 18 }
    );
    const hybrid = L.layerGroup([satellite, labels]);
    street.addTo(m);
    L.control
      .layers({ "Street map": street, "Satellite": satellite, "Satellite + names": hybrid }, undefined, {
        position: "topright",
        collapsed: false,
      })
      .addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    m.on("moveend", load);
    m.on("click", (e: L.LeafletMouseEvent) => {
      setAccuracy(null);
      choose(e.latlng.lat, e.latlng.lng);
    });
    load();
    return () => {
      m.remove();
      map.current = null;
    };
  }, [load, choose]);

  useEffect(() => {
    load();
  }, [nightOnly, shown, load]);

  // is there already a point within 100 m of the chosen spot?
  const nearby = useMemo(() => {
    if (!picked) return null;
    let best: { p: Pt; d: number } | null = null;
    for (const p of pts) {
      const d = distM(picked.lat, picked.lng, p.pt_lat, p.pt_lng);
      if (d <= RADIUS_M && (!best || d < best.d)) best = { p, d };
    }
    return best;
  }, [picked, pts]);

  function goToCoords() {
    const n1 = Number(c1.trim().replace(",", "."));
    const n2 = Number(c2.trim().replace(",", "."));
    if (!c1.trim() || !c2.trim() || Number.isNaN(n1) || Number.isNaN(n2)) {
      return setMsg("Type both numbers (digits only, use a point for decimals).");
    }
    let lat: number, lng: number;
    if (coordMode === "latlng") {
      if (n1 < -90 || n1 > 90) return setMsg("Latitude must be between -90 and 90.");
      if (n2 < -180 || n2 > 180) return setMsg("Longitude must be between -180 and 180.");
      lat = n1;
      lng = n2;
    } else {
      if (n1 < 100000 || n1 > 900000) return setMsg("Easting should be between 100000 and 900000.");
      if (n2 < 0 || n2 > 10000000) return setMsg("Northing should be between 0 and 10000000.");
      ({ lat, lng } = utmToLatLng(n1, n2, Number(zone), true));
    }
    map.current?.setView([lat, lng], 18);
    choose(lat, lng);
    setAccuracy(null);
    setMsg("");
  }

  function locate() {
    if (!navigator.geolocation) return setMsg("This device cannot share location.");
    setMsg("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const { latitude, longitude, accuracy: acc } = p.coords;
        map.current?.setView([latitude, longitude], 18);
        choose(latitude, longitude);
        setAccuracy(Math.round(acc));
        setMsg(
          acc > RADIUS_M
            ? `GPS accuracy is only about ${Math.round(acc)} m. Tap the map to adjust the spot.`
            : ""
        );
      },
      (err) =>
        setMsg(
          err.code === 1
            ? "Location blocked. Allow location for this site in the browser, then try again."
            : "Could not get your location. Move to an open area or tap the map instead."
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return setMsg("Use your location or tap the map to choose where the problem is.");
    setBusy(true);
    const { error } = await supabase.from("hazard_reports").insert({
      category: form.category,
      severity: sensitive ? 3 : form.severity,
      time_of_day: form.time_of_day,
      description: sensitive ? null : form.description.trim() || null,
      lat: picked.lat,
      lng: picked.lng,
      reporter_token: deviceToken(),
    });
    setBusy(false);
    if (error) return setMsg("Report not sent: " + error.message);
    setMsg(sensitive ? "Thank you. Your anonymous report was added. If you or someone you know needs help, contact your local emergency number (for example 112) or a person you trust." : "Thank you. Your anonymous report was added.");
    setForm({ ...form, description: "" });
    pin.current?.remove();
    setPicked(null);
    setAccuracy(null);
    load();
  }

  function sos() {
    if (!navigator.geolocation) return setMsg("This device cannot share location.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const url = `https://www.google.com/maps?q=${p.coords.latitude},${p.coords.longitude}`;
        const text = `I need help. My location now: ${url}`;
        if (navigator.share) navigator.share({ text }).catch(() => {});
        else window.location.href = `sms:?body=${encodeURIComponent(text)}`;
      },
      () => setMsg("Please allow location access to use SOS."),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  return (
    <main className="app">
      <section className="hero">
        <div className="fog" /><div className="fog f2" />
      <header className="top">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo.svg" alt="" width={38} height={38} />
          <h1>SafeRoute</h1>
        </div>
        <div className="actions">
          <InstallButton />
          <button className="sos" onClick={sos}>SOS: share my location</button>
        </div>
      </header>
        <h2 className="headline">Know the route before you walk it.</h2>
        <p className="sub">Anonymous reports from the community, turned into a live safety map.</p>
      </section>

      <div className="stage" id="map">
      <div className="filters">
        <label>
          <input type="checkbox" checked={nightOnly} onChange={(e) => setNightOnly(e.target.checked)} />{" "}
          Show evening and night risk only
        </label>
        <span className="legend">
          Each circle is one 100 m point. Risk: <i style={{ background: "#facc15" }} /> low{" "}
          <i style={{ background: "#f59e0b" }} /> medium <i style={{ background: "#ea580c" }} /> high{" "}
          <i style={{ background: "#b91c1c" }} /> very high
        </span>
      </div>

      <details className="cases">
        <summary>Cases shown: {shown.length === ALL_KEYS.length ? "all types" : `${shown.length} of ${ALL_KEYS.length}`}</summary>
        <div className="chips">
          <button type="button" onClick={() => setShown(ALL_KEYS)}>Show all</button>
          <button type="button" onClick={() => setShown(SERIOUS)}>Serious crimes only</button>
          <button type="button" onClick={() => setShown([])}>Clear</button>
        </div>
        <div className="chips">
          {ALL_KEYS.map((k) => (
            <label key={k} className={shown.includes(k) ? "chip on" : "chip"}>
              <input type="checkbox" checked={shown.includes(k)} onChange={() => toggle(k)} />
              {CATEGORIES[k]}
            </label>
          ))}
        </div>
      </details>

      <div ref={mapEl} className="map" />
      </div>

      <details className="panel guide" id="help">
        <summary>What is SafeRoute and how do I use it?</summary>
        <p><b>What it is.</b> A community safety map. People anonymously report unsafe places (broken lights, empty roads, harassment, theft). The map turns the reports into coloured circles, so everyone can see where the risk is higher, especially at night.</p>
        <p><b>Who it is for.</b> Women and girls, students, commuters and residents who want to plan safer routes. Campus and community groups, and local authorities, can use the hotspots to decide where to fix lights or add patrols.</p>
        <p><b>How to use it.</b></p>
        <ol>
          <li>Look at the map. Darker circles mean higher risk. Tap a circle to see how many reports it has.</li>
          <li>Switch to Satellite to see the real surroundings, or tick the night filter.</li>
          <li>To report a problem, press &quot;Use my current location&quot;, tap the map, or type coordinates.</li>
          <li>Choose the problem, how serious it is, and when it happens. Press Send.</li>
          <li>Reports within 100 m of each other are counted as the same point.</li>
          <li>In danger, press SOS to send your location to someone you trust.</li>
        </ol>
        <p><b>Privacy.</b> No account, no names. Please do not write anyone&apos;s name in a note.</p>
        <p><b>Important.</b> SafeRoute is not an emergency service. In an emergency, call your local emergency number (for example 112).</p>
      </details>


      <section className="panel" id="coords">
        <h2>Enter coordinates</h2>
        <label>
          Format
          <select
            value={coordMode}
            onChange={(e) => {
              setCoordMode(e.target.value as "latlng" | "utm");
              setC1("");
              setC2("");
            }}
          >
            <option value="latlng">Latitude and longitude (degrees)</option>
            <option value="utm">Easting and northing (UTM, metres)</option>
          </select>
        </label>
        {coordMode === "utm" && (
          <label>
            UTM zone (Nigeria is in zones 31, 32 and 33, northern hemisphere)
            <select value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value="31">Zone 31 (west of 6°E, includes Ilorin and Lagos)</option>
              <option value="32">Zone 32 (6°E to 12°E, includes Abuja)</option>
              <option value="33">Zone 33 (east of 12°E)</option>
            </select>
          </label>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label>
            {coordMode === "latlng" ? "Latitude (e.g. 8.4966)" : "Easting (e.g. 669745.91)"}
            <input
              type="text"
              inputMode="decimal"
              value={c1}
              onChange={(e) => setC1(e.target.value)}
              style={{ padding: 8, border: "1px solid #cbd5e1", borderRadius: 8, font: "inherit" }}
            />
          </label>
          <label>
            {coordMode === "latlng" ? "Longitude (e.g. 4.5421)" : "Northing (e.g. 939535.99)"}
            <input
              type="text"
              inputMode="decimal"
              value={c2}
              onChange={(e) => setC2(e.target.value)}
              style={{ padding: 8, border: "1px solid #cbd5e1", borderRadius: 8, font: "inherit" }}
            />
          </label>
        </div>
        <button type="button" onClick={goToCoords}>Go to this point and select it</button>
        <p className="hint">
          Coordinates must be WGS84, as given by a phone GPS or Google Maps. Values from the Minna datum
          can be off by 100 m or more.
        </p>
      </section>

      <AlertPanel />

      <form className="panel" id="report" onSubmit={submit}>
        <h2>Report an unsafe place (anonymous)</h2>
        <button type="button" className="locate" onClick={locate}>
          Use my current location
        </button>
        <p className="hint">
          {picked
            ? `Location chosen: ${picked.lat.toFixed(6)}, ${picked.lng.toFixed(6)} | UTM zone ${zoneOf(picked.lng)}N: E ${latLngToUtm(picked.lat, picked.lng).easting.toFixed(1)}, N ${latLngToUtm(picked.lat, picked.lng).northing.toFixed(1)}${
                accuracy ? ` (GPS accuracy about ${accuracy} m)` : ""
              }`
            : "Press the button above, or tap the map to choose the place."}
        </p>
        {picked && (
          <p className="hint">
            {nearby
              ? `A point already exists ${Math.round(nearby.d)} m away (${nearby.p.report_count} report(s)). Your report will be added to it.`
              : "No point within 100 m. Your report will start a new point."}
          </p>
        )}
        <label>
          What is the problem?
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        {!sensitive && (
        <label>
          How serious?
          <select value={form.severity} onChange={(e) => setForm({ ...form, severity: Number(e.target.value) })}>
            <option value={1}>Minor</option>
            <option value={2}>Serious</option>
            <option value={3}>Dangerous</option>
          </select>
        </label>
        )}
        <label>
          When does it happen?
          <select value={form.time_of_day} onChange={(e) => setForm({ ...form, time_of_day: e.target.value })}>
            <option value="day">Daytime</option>
            <option value="evening">Evening</option>
            <option value="night">Night</option>
          </select>
        </label>
        {sensitive ? (
          <p className="hint">No note is collected for this type of report, to protect privacy. Only the place and time are saved.</p>
        ) : (
        <label>
          Short note (optional, max 280 characters, no names)
          <textarea maxLength={280} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        )}
        <button type="submit" disabled={busy}>{busy ? "Sending…" : "Send anonymous report"}</button>
        {msg && <p className="msg">{msg}</p>}
      </form>

      <footer style={{ textAlign: "center", padding: "8px 12px 28px", fontSize: 13, color: "#5b6785" }}>
        <p style={{ margin: 0 }}>
          Developed by <b>AHMED MUHAMMED OMOKUNMI</b> &amp; <b>RUQAYAH SHEHU</b>
        </p>
        <p style={{ margin: "2px 0 0" }}>MSc Surveying and Geo-Informatics</p>
      </footer>
      <nav className="tabbar" aria-label="Sections">
        <a href="#map">Map</a>
        <a href="#report">Report</a>
        <a href="#coords">Coords</a>
        <a href="#alerts">Alerts</a>
        <a href="#help">Guide</a>
      </nav>
    </main>
  );
}
