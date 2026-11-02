"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

const RADIUS_M = 100; // alert distance
const COOLDOWN_MS = 10 * 60 * 1000; // do not repeat the same alert for 10 minutes

type Pt = { pt_id: string; pt_lat: number; pt_lng: number; report_count: number; risk_score: number };
type Tone = "chime" | "beep" | "siren" | "custom";

function distM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}
function load(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* storage full or blocked */ }
}

// Keep the risk points on the phone so alerts still work with no internet
function remember(fresh: Pt[]): Pt[] {
  try {
    const old: Pt[] = JSON.parse(load("sr_pts", "[]"));
    const m = new Map(old.map((q) => [q.pt_id, q]));
    fresh.forEach((q) => m.set(q.pt_id, q));
    const all = Array.from(m.values()).slice(-3000);
    save("sr_pts", JSON.stringify(all));
    return all;
  } catch {
    return fresh;
  }
}

export default function AlertPanel() {
  const [on, setOn] = useState(false);
  const [tone, setTone] = useState<Tone>("chime");
  const [level, setLevel] = useState("5");
  const [customName, setCustomName] = useState("");
  const [status, setStatus] = useState("Alerts are off.");
  const [alertInfo, setAlertInfo] = useState<{ dist: number; count: number } | null>(null);

  const watch = useRef<number | null>(null);
  const pts = useRef<Pt[]>([]);
  const lastFetch = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const lastAlert = useRef<Record<string, number>>({});
  const ctx = useRef<AudioContext | null>(null);
  const master = useRef<GainNode | null>(null);
  const customBuf = useRef<AudioBuffer | null>(null);
  const wake = useRef<WakeLockSentinel | null>(null);
  const toneRef = useRef<Tone>("chime");
  const levelRef = useRef(5);
  toneRef.current = tone;
  levelRef.current = Number(level);

  const getCtx = useCallback(() => {
    if (!ctx.current) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx.current = new AC();
    }
    if (ctx.current.state === "suspended") void ctx.current.resume();
    return ctx.current;
  }, []);

  const decode = useCallback(async (url: string) => {
    try {
      const buf = await (await fetch(url)).arrayBuffer();
      customBuf.current = await getCtx().decodeAudioData(buf);
    } catch {
      customBuf.current = null;
      setStatus("That sound file could not be read. Try an MP3 or WAV file.");
    }
  }, [getCtx]);

  const stopSound = useCallback(() => {
    master.current?.disconnect();
    master.current = null;
  }, []);

  const play = useCallback((name: Tone) => {
    stopSound();
    const c = getCtx();
    const out = c.createGain();
    out.connect(c.destination);
    master.current = out;
    const t = c.currentTime + 0.05;
    const note = (type: OscillatorType, f1: number, f2: number, t0: number, dur: number) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f1, t0);
      if (f2 !== f1) o.frequency.linearRampToValueAtTime(f2, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    };
    if (name === "custom" && customBuf.current) {
      const s = c.createBufferSource();
      s.buffer = customBuf.current;
      s.connect(out);
      s.start(t);
      s.stop(t + 15);
    } else if (name === "beep") {
      for (let i = 0; i < 8; i++) note("square", 1000, 1000, t + i * 0.3, 0.15);
    } else if (name === "siren") {
      for (let i = 0; i < 4; i++) {
        note("sawtooth", 600, 1200, t + i * 0.9, 0.45);
        note("sawtooth", 1200, 600, t + i * 0.9 + 0.45, 0.45);
      }
    } else {
      for (let i = 0; i < 3; i++) {
        note("sine", 880, 880, t + i * 1.1, 0.3);
        note("sine", 1318, 1318, t + i * 1.1 + 0.3, 0.5);
      }
    }
  }, [getCtx, stopSound]);

  const fire = useCallback((dist: number, count: number) => {
    setAlertInfo({ dist: Math.round(dist), count });
    play(toneRef.current);
    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]);
  }, [play]);

  const onPos = useCallback(async (p: GeolocationPosition) => {
    const { latitude: lat, longitude: lng, accuracy } = p.coords;
    setStatus(
      `Watching your location (GPS accuracy about ${Math.round(accuracy)} m).` +
        (accuracy > RADIUS_M ? " Accuracy is low, so alerts may come early or late." : "")
    );
    const lf = lastFetch.current;
    if (!lf || Date.now() - lf.t > 120000 || distM(lat, lng, lf.lat, lf.lng) > 300) {
      lastFetch.current = { lat, lng, t: Date.now() };
      if (navigator.onLine) {
        const dLat = 0.012;
        const dLng = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
        const { data, error } = await supabase.rpc("risk_points", {
          min_lat: lat - dLat, min_lng: lng - dLng, max_lat: lat + dLat, max_lng: lng + dLng, only_evening_night: false,
        });
        if (error) setStatus("Database not reachable. Using the risk points saved on this phone.");
        else pts.current = remember((data as Pt[]) || []);
      } else {
        setStatus("No internet. Using the risk points saved on this phone.");
      }
    }
    const now = Date.now();
    for (const q of pts.current) {
      if (q.risk_score < levelRef.current) continue;
      const d = distM(lat, lng, q.pt_lat, q.pt_lng);
      if (d <= RADIUS_M && now - (lastAlert.current[q.pt_id] ?? 0) > COOLDOWN_MS) {
        lastAlert.current[q.pt_id] = now;
        fire(d, q.report_count);
        break;
      }
    }
  }, [fire]);

  const keepAwake = useCallback(async () => {
    try { wake.current = (await navigator.wakeLock?.request("screen")) ?? null; } catch { /* not supported */ }
  }, []);

  async function start() {
    if (!navigator.geolocation) return setStatus("This device cannot share location.");
    getCtx();
    try { pts.current = JSON.parse(load("sr_pts", "[]")); } catch { pts.current = []; }
    if (tone === "custom" && !customBuf.current) {
      const u = load("sr_custom_url", "");
      if (u) await decode(u);
    }
    setOn(true);
    setStatus("Finding your location…");
    watch.current = navigator.geolocation.watchPosition(
      onPos,
      (e) => setStatus(e.code === 1 ? "Location is blocked. Allow location for this site, then try again." : "Could not get your location."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    await keepAwake();
  }

  function stop() {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    wake.current?.release().catch(() => {});
    wake.current = null;
    stopSound();
    setOn(false);
    setAlertInfo(null);
    setStatus("Alerts are off.");
  }

  function saveArea() {
    if (!navigator.geolocation) return setStatus("This device cannot share location.");
    setStatus("Saving the area around you…");
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const { latitude: lat, longitude: lng } = p.coords;
        const dLat = 0.05; // about 5 km each way
        const dLng = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
        const { data, error } = await supabase.rpc("risk_points", {
          min_lat: lat - dLat, min_lng: lng - dLng, max_lat: lat + dLat, max_lng: lng + dLng, only_evening_night: false,
        });
        if (error) return setStatus("Could not save the area: " + error.message);
        const all = remember((data as Pt[]) || []);
        pts.current = all;
        setStatus(`Saved ${all.length} risk point(s) within about 5 km. Alerts now work without internet.`);
      },
      () => setStatus("Allow location so the area around you can be saved."),
      { enableHighAccuracy: true, timeout: 20000 }
    );
  }

  function test() {
    setAlertInfo({ dist: 60, count: 3 });
    play(tone);
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
  }

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 1024 * 1024) return setStatus("Choose a sound file under 1 MB.");
    const r = new FileReader();
    r.onload = async () => {
      const url = String(r.result);
      await decode(url);
      save("sr_custom_url", url);
      save("sr_custom_name", f.name);
      save("sr_tone", "custom");
      setCustomName(f.name);
      setTone("custom");
      setStatus("Your tone is saved on this device: " + f.name);
    };
    r.readAsDataURL(f);
  }

  useEffect(() => {
    setTone(load("sr_tone", "chime") as Tone);
    setLevel(load("sr_level", "5"));
    setCustomName(load("sr_custom_name", ""));
    const onVisible = () => { if (document.visibilityState === "visible" && watch.current !== null) void keepAwake(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    };
  }, [keepAwake]);

  return (
    <>
      {alertInfo && (
        <div className="alertbar" role="alert">
          <div>
            <b>Caution: high-risk point within {alertInfo.dist} m</b>
            <br />
            <span>{alertInfo.count} report(s) nearby. Stay alert and stay with other people if you can.</span>
          </div>
          <button onClick={() => { stopSound(); setAlertInfo(null); }}>Dismiss</button>
        </div>
      )}

      <section className="panel" id="alerts">
        <h2>Nearby danger alerts</h2>
        <p className="hint">
          While this page is open, SafeRoute rings an alarm when you come within 100 m of a high-risk point.
          It works without internet if you first save your area while online. It needs the screen on: phone browsers cannot track you once the app is closed or the screen is locked.
        </p>
        <label>
          Alert me for
          <select value={level} onChange={(e) => { setLevel(e.target.value); save("sr_level", e.target.value); }}>
            <option value="10">Very high risk only</option>
            <option value="5">High risk and above</option>
            <option value="2">Medium risk and above</option>
          </select>
        </label>
        <label>
          Alarm tone
          <select value={tone} onChange={(e) => { setTone(e.target.value as Tone); save("sr_tone", e.target.value); }}>
            <option value="chime">Soft chime</option>
            <option value="beep">Urgent beeps</option>
            <option value="siren">Siren</option>
            <option value="custom" disabled={!customName}>{customName ? `My tone: ${customName}` : "My own tone (choose a file below)"}</option>
          </select>
        </label>
        <label>
          Use my own ringtone (MP3 or WAV, under 1 MB)
          <input type="file" accept="audio/*" onChange={pick} />
        </label>
        <button type="button" onClick={saveArea}>Save this area for offline use</button>
        <button type="button" onClick={test}>Test alert and sound</button>
        {on ? (
          <button type="button" onClick={stop}>Turn alerts off</button>
        ) : (
          <button type="button" className="locate" onClick={start}>Turn alerts on</button>
        )}
        <p className="hint">{status}</p>
      </section>
    </>
  );
}
