import { useEffect, useState } from "react";
const EV = {
  "Heavy Rainfall": "🌧️",
  Thunderstorm: "⛈️",
  Flood: "🌊",
  "Flash Flood": "🌊",
  Heatwave: "🔥",
  "Cold Wave": "🥶",
  Fog: "🌫️",
  "Dust Storm": "🌪️",
  "Strong Winds": "💨",
  Cyclone: "🌀",
  Lightning: "⚡",
  Landslide: "⛰️",
  Drought: "🏜️",
  Other: "❓",
};
const COL = {
  Verified: "#15803d",
  "Partially Verified": "#ca8a04",
  Unverified: "#64748b",
  Conflicting: "#dc2626",
  "Under Review": "#2563eb",
};
let TOKEN = "";
const api = (u, o = {}) =>
  fetch("/api" + u, {
    ...o,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN && { Authorization: "Bearer " + TOKEN }),
    },
    body: o.body && JSON.stringify(o.body),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    return j;
  });
const B = ({ s }) => (
  <span className="badge" style={{ background: COL[s] || "#dc2626" }}>
    {s}
  </span>
);
const use = (u, dep = []) => {
  const [d, set] = useState();
  useEffect(() => {
    api(u)
      .then(set)
      .catch(() => set(null));
  }, dep);
  return d;
};
const LiveBadge = () => (
  <span className="badge" style={{ background: "#0891b2" }}>
    LIVE
  </span>
);
const getGeo = () =>
  new Promise((res, rej) => {
    if (!navigator.geolocation)
      return rej(new Error("Geolocation is not supported by this browser."));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => rej(new Error(e.message || "Location permission denied.")),
      { timeout: 8000 },
    );
  });
const Bars = ({ rows }) => {
  const m = Math.max(...rows.map((r) => r.n), 1);
  return rows.map((r) => (
    <div className="bar" key={r._id}>
      <span>{r._id || "n/a"}</span>
      <i style={{ width: `${(r.n / m) * 60}%` }} />
      <span>{r.n}</span>
    </div>
  ));
};
function Dash({ go }) {
  const [n, bump] = useState(0);
  const a = use("/analytics", [n]),
    al = use("/alerts", [n]),
    live = use("/live-status");
  const [busy, setBusy] = useState(false),
    [msg, setMsg] = useState("");
  if (a === null) return <p>API unreachable. Start the server and MongoDB.</p>;
  if (!a) return <p>Loading…</p>;
  const st = (x) => a.byStatus.find((y) => y._id === x)?.n || 0;
  const cards = [
    ["Total reports", a.total],
    ["Verified", st("Verified")],
    ["Partially verified", st("Partially Verified")],
    ["Conflicting", st("Conflicting")],
    ["Unverified", st("Unverified")],
    ["Sources", a.sources],
    ["Affected states", a.byState.length],
    ["Active alerts", al?.length || 0],
  ];
  const pull = () => {
    setBusy(true);
    setMsg("Pulling live weather + news…");
    api("/refresh-live", { method: "POST" })
      .then((r) => {
        setMsg(
          r.error || r.skipped
            ? r.error || r.message
            : `Added ${r.created} live reports.${r.errors?.length ? " Some sources failed: " + r.errors[0] : ""}`,
        );
        bump(n + 1);
      })
      .catch((e) => setMsg(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <div className="hero">
        <h1>One Nation. Multiple Sources. Verified Weather Intelligence.</h1>
        <p>
          Aggregating reports from IMD, weather APIs, news and citizen
          observations for AI-assisted verification and disaster intelligence.
        </p>
        <button className="btn" onClick={() => go("map")}>
          View live map
        </button>{" "}
        <button className="btn alt" onClick={() => go("citizen")}>
          Report weather event
        </button>
      </div>
      <p>
        <span className="demo">
          Baseline data is demo/mock.{" "}
          {live ? (
            live.weather || live.news ? (
              <>
                Live sources connected:{" "}
                {[live.weather && "OpenWeatherMap", live.news && "NewsAPI"]
                  .filter(Boolean)
                  .join(", ")}
                . No private social-media APIs (X/Instagram) are connected.
              </>
            ) : (
              "No live API keys configured on the server yet — see .env.example."
            )
          ) : (
            ""
          )}
        </span>{" "}
        {(live?.weather || live?.news) && (
          <button className="btn" disabled={busy} onClick={pull}>
            {busy ? "Refreshing…" : "Pull live data"}
          </button>
        )}{" "}
        {msg && <small> {msg}</small>}
      </p>
      <div className="grid">
        {cards.map(([l, v]) => (
          <div className="card" key={l}>
            <h3>{v}</h3>
            <small>{l}</small>
          </div>
        ))}
      </div>
      <h2>Active alerts</h2>
      <div className="grid">
        {al?.map((x) => (
          <div className={"card " + x.level} key={x._id}>
            <b>
              {x.level} · {x.eventType}
            </b>
            <br />
            {x.city}, {x.state}
            <br />
            <small>
              {x.message} · confidence {x.confidence}% (AI-assisted)
            </small>
          </div>
        ))}
      </div>
    </>
  );
}
function Detail({ id, close }) {
  const d = use("/reports/" + id, [id]);
  if (!d) return null;
  const r = d.report;
  const by = {};
  [r, ...d.related].forEach((x) => (by[x.sourceName] = x));
  return (
    <div className="card">
      <button className="btn alt" onClick={close}>
        Back
      </button>
      <h2>
        {EV[r.eventType]} {r.eventType} — {r.location.city}, {r.location.state}
      </h2>
      <p>
        “{r.reportText}” <small>({r.sourceName})</small>{" "}
        {r.isLive && <LiveBadge />}
      </p>
      <B s={r.verificationStatus} /> <b>Confidence {r.confidenceScore}%</b>{" "}
      <small>AI-assisted verification</small>
      <p>{r.aiReason}</p>
      <h3>Source consensus</h3>
      {[
        "IMD",
        "Weather API",
        "Verified News",
        "Citizen Report",
        "Social Media",
      ].map((n) => {
        const x = by[n];
        return (
          <div className="bar" key={n}>
            <span>{n}</span>
            <i
              style={{ width: x ? (x.confidenceScore || 50) * 0.6 + "%" : "0" }}
            />
            <span>
              {x
                ? /\b(no|not|normal)\b/i.test(x.reportText)
                  ? "✗ disputes"
                  : "✓"
                : "? none"}
            </span>
          </div>
        );
      })}
      <p>
        Possible duplicate reports: {d.duplicates.length} · Conflicting reports:{" "}
        {d.conflicts.length}
      </p>
      <h3>Verification history</h3>
      {d.history.map((h) => (
        <div key={h._id}>
          {h.actor}: {h.action}{" "}
          <small>{new Date(h.createdAt).toLocaleTimeString()}</small>
        </div>
      ))}
      {!d.history.length && <small>No manual actions yet.</small>}
    </div>
  );
}
function Reports({ admin }) {
  const [f, setF] = useState({
    search: '',
    status: '',
    event: '',
    source: '',
    state: '',
    city: '',
    from: '',
    to: ''
  });

  const [sel, setSel] = useState();
  const [n, bump] = useState(0);

  const q = new URLSearchParams(
    Object.entries(f).filter(([, v]) => v)
  ).toString();

  const d = use('/reports?limit=50&' + q, [q, n]);

  if (sel) {
    return <Detail id={sel} close={() => setSel()} />;
  }

  const act = (id, status) =>
    api('/verify/' + id, {
      method: 'POST',
      body: { status }
    })
      .then(() => bump(n + 1))
      .catch(e => alert(e.message));

  const clearFilters = () => {
    setF({
      search: '',
      status: '',
      event: '',
      source: '',
      state: '',
      city: '',
      from: '',
      to: ''
    });
  };

  return (
    <>
      <div className="filters">

        <input
          placeholder="Search reports"
          value={f.search}
          onChange={e =>
            setF({ ...f, search: e.target.value })
          }
        />

        <input
          placeholder="State (e.g. Chhattisgarh)"
          value={f.state}
          onChange={e =>
            setF({ ...f, state: e.target.value })
          }
        />

        <input
          placeholder="City (e.g. Raipur)"
          value={f.city}
          onChange={e =>
            setF({ ...f, city: e.target.value })
          }
        />

        <select
          value={f.status}
          onChange={e =>
            setF({ ...f, status: e.target.value })
          }
        >
          <option value="">All statuses</option>
          {Object.keys(COL).map(s => (
            <option key={s}>{s}</option>
          ))}
        </select>

        <select
          value={f.event}
          onChange={e =>
            setF({ ...f, event: e.target.value })
          }
        >
          <option value="">All events</option>
          {Object.keys(EV).map(s => (
            <option key={s}>{s}</option>
          ))}
        </select>

        <select
          value={f.source}
          onChange={e =>
            setF({ ...f, source: e.target.value })
          }
        >
          <option value="">All sources</option>
          {['Official', 'API', 'News', 'Citizen', 'Social'].map(s => (
            <option key={s}>{s}</option>
          ))}
        </select>

        <label>
          From
          <input
            type="date"
            value={f.from}
            onChange={e =>
              setF({ ...f, from: e.target.value })
            }
          />
        </label>

        <label>
          To
          <input
            type="date"
            value={f.to}
            onChange={e =>
              setF({ ...f, to: e.target.value })
            }
          />
        </label>

        <button
          className="btn alt"
          onClick={clearFilters}
        >
          Clear filters
        </button>

      </div>

      <p>
        <small>
          Showing {d?.items?.length || 0} of {d?.total || 0} reports
        </small>
      </p>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Location</th>
              <th>Event</th>
              <th>Report</th>
              <th>Status</th>
              <th>Conf.</th>
              {admin && <th>Action</th>}
            </tr>
          </thead>

          <tbody>
            {d?.items?.map(r => (
              <tr
                className="click"
                key={r._id}
                onClick={() => setSel(r._id)}
              >
                <td>
                  {r.sourceName}
                  {' '}
                  {r.isLive && <LiveBadge />}
                </td>

                <td>
                  {r.location.city}
                  {r.location.state
                    ? ', ' + r.location.state
                    : ''}
                </td>

                <td>
                  {EV[r.eventType]} {r.eventType}
                </td>

                <td>{r.reportText}</td>

                <td>
                  <B s={r.verificationStatus} />
                </td>

                <td>
                  {r.confidenceScore}%
                </td>

                {admin && (
                  <td
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      className="btn"
                      onClick={() =>
                        act(r._id, 'Verified')
                      }
                    >
                      Verify
                    </button>

                    <button
                      className="btn alt"
                      onClick={() =>
                        act(r._id, 'Rejected')
                      }
                    >
                      Reject
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {d?.items?.length === 0 && (
        <div className="card">
          No reports match the selected filters.
        </div>
      )}
    </>
  );
}
const INDIA_PATH =
  "M 567.4 183.1 L 568.8 190.2 L 562.3 193.6 L 563.8 205.1 L 550.5 201.7 L 526.3 214.6 L 526.9 225.3 L 516.6 241.0 L 515.6 250.1 L 507.3 265.5 L 492.7 261.2 L 492.0 280.5 L 487.8 286.9 L 489.8 294.8 L 480.6 299.2 L 470.7 269.6 L 465.6 269.7 L 462.5 281.6 L 452.3 271.9 L 458.1 261.3 L 466.4 260.2 L 475.0 244.4 L 464.3 241.2 L 446.9 241.5 L 429.2 239.0 L 427.5 226.0 L 418.6 225.1 L 403.8 217.0 L 397.2 229.7 L 410.7 239.5 L 399.1 246.5 L 394.9 253.3 L 406.4 258.3 L 403.2 269.6 L 409.7 283.6 L 412.6 299.0 L 409.9 305.8 L 397.2 305.5 L 374.2 309.4 L 375.3 323.5 L 365.3 334.5 L 338.5 347.1 L 317.6 369.0 L 303.5 380.8 L 284.9 393.0 L 284.9 401.6 L 275.6 406.2 L 258.8 412.9 L 250.1 413.9 L 244.5 428.1 L 248.4 452.4 L 249.3 467.9 L 241.4 485.6 L 241.3 517.3 L 231.7 518.2 L 223.2 532.5 L 228.9 538.6 L 211.9 543.9 L 205.6 556.6 L 198.1 562.0 L 180.4 544.5 L 171.8 518.4 L 164.6 499.6 L 158.1 490.8 L 148.1 472.8 L 143.5 449.5 L 140.3 437.8 L 123.3 412.2 L 115.6 376.0 L 110.0 352.1 L 110.1 329.5 L 106.4 312.0 L 79.3 323.2 L 66.1 321.0 L 41.7 298.3 L 50.7 291.6 L 45.2 284.3 L 23.3 268.4 L 35.7 256.0 L 76.8 256.0 L 73.1 240.0 L 62.6 230.5 L 60.5 216.2 L 48.3 207.8 L 68.8 188.2 L 90.5 189.6 L 110.0 170.1 L 121.7 151.1 L 139.9 132.4 L 139.6 119.1 L 155.5 108.3 L 140.4 99.1 L 133.9 86.4 L 127.3 70.1 L 136.5 62.0 L 164.8 66.6 L 185.6 63.8 L 203.6 48.1 L 223.7 70.0 L 221.8 85.2 L 229.2 94.8 L 228.6 104.3 L 215.2 101.8 L 220.5 122.4 L 238.8 134.2 L 264.7 147.2 L 252.9 155.7 L 245.7 173.2 L 263.7 180.2 L 281.3 189.4 L 305.7 199.9 L 331.3 202.3 L 342.0 211.8 L 356.5 213.6 L 378.9 217.9 L 394.5 217.6 L 396.6 210.2 L 394.1 198.3 L 395.6 190.3 L 407.0 186.4 L 408.5 201.1 L 408.9 204.8 L 425.9 211.9 L 437.6 209.0 L 453.4 210.2 L 468.6 209.7 L 469.9 198.2 L 462.3 192.3 L 477.4 189.9 L 494.4 176.0 L 515.9 164.2 L 531.6 168.7 L 544.9 160.9 L 553.6 172.5 L 547.3 180.3 L 567.4 183.1 Z";
function MapView() {
  const d = use("/events");
  const [s, setS] = useState();
  const [me, setMe] = useState();
  const [wx, setWx] = useState();
  const [err, setErr] = useState();
  const [busy, setBusy] = useState(false);
  const x = (l) => ((l - 68) / 30) * 560 + 20,
    y = (l) => ((37 - l) / 30) * 560 + 20;
  const locate = () => {
    setErr();
    setBusy(true);
    getGeo()
      .then(({ lat, lon }) => {
        setMe({ lat, lon });
        return api(`/weather-here?lat=${lat}&lon=${lon}`);
      })
      .then(setWx)
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <div className="filters">
        <button className="btn" disabled={busy} onClick={locate}>
          {busy ? "Locating…" : "My location + live weather"}
        </button>
        {Object.entries(COL).map(([k, c]) => (
          <span key={k} className="badge" style={{ background: c }}>
            {k}
          </span>
        ))}
        <span className="badge" style={{ background: "#7c3aed" }}>
          You
        </span>
      </div>
      {err && (
        <p>
          <small>{err}</small>
        </p>
      )}
      {wx && (
        <div className="card">
          <b>Live weather at your location ({wx.place})</b>
          <br />
          {wx.description}, {wx.temp}°C (feels {wx.feelsLike}°C) · humidity{" "}
          {wx.humidity}% · wind {wx.wind} m/s
          {wx.rain ? ` · rainfall ${wx.rain}mm/h` : ""} <LiveBadge />
        </div>
      )}
      <svg className="map" viewBox="0 0 600 600">
        <path
          d={INDIA_PATH}
          fill="#dbeafe"
          stroke="#7fa8cc"
          strokeWidth="1.5"
        />
        {d?.map((e) => (
          <circle
            key={e._id}
            cx={x(e.location.longitude)}
            cy={y(e.location.latitude)}
            r="11"
            fill={COL[e.status]}
            onClick={() => setS(e)}
          />
        ))}
        {me && (
          <circle
            cx={x(me.lon)}
            cy={y(me.lat)}
            r="8"
            fill="#7c3aed"
            stroke="#fff"
            strokeWidth="2"
            onClick={() =>
              setS({
                eventType: "Other",
                location: { city: "Your location", state: "" },
                sources: ["Device GPS"],
                reportCount: 1,
                confidence: 100,
                status: "Verified",
              })
            }
          />
        )}
        <text x="12" y="590" fontSize="11" fill="#5b6b80">
          India outline (Natural Earth, 110m resolution)
        </text>
      </svg>
      {d && !d.length && (
        <p>
          <small>
            No events yet — go to the Dashboard and click “Pull live data”, or
            submit a citizen report, then come back here.
          </small>
        </p>
      )}
      {s && (
        <div className="card">
          <h3>
            {EV[s.eventType]} {s.eventType}
          </h3>
          {s.location.city}
          {s.location.state ? ", " + s.location.state : ""}
          <br />
          Sources: {s.sources.join(", ")} · {s.reportCount} report
          {s.reportCount === 1 ? "" : "s"}
          <br />
          Confidence {s.confidence}% <B s={s.status} />
        </div>
      )}
    </>
  );
}
function Analytics() {
  const a = use("/analytics");
  if (!a) return null;
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}
    >
      {[
        ["Reports by event", a.byEvent],
        ["Reports by state", a.byState],
        ["Verification status", a.byStatus],
        ["Source distribution", a.bySource],
      ].map(([t, r]) => (
        <div className="card" key={t}>
          <h3 style={{ fontSize: 16 }}>{t}</h3>
          <Bars rows={r} />
        </div>
      ))}
    </div>
  );
}
function Center({ admin }) {
  const c = use("/reports?status=Conflicting&limit=50"),
    u = use("/reports?status=Unverified&limit=50"),
    au = use(admin ? "/audit" : "/alerts");
  return (
    <>
      <h2>Flagged for review</h2>
      <p>
        Misleading claims are never deleted; they wait here for a human
        decision.
      </p>
      {[...(c?.items || []), ...(u?.items || [])].map((r) => (
        <div className="card" key={r._id} style={{ marginBottom: 8 }}>
          <B s={r.verificationStatus} /> <b>{r.sourceName}</b> —{" "}
          {r.location.city}: “{r.reportText}”<br />
          <small>{r.aiReason}</small>
        </div>
      ))}
      {admin && (
        <>
          <h2>Admin audit log</h2>
          {au?.map((h) => (
            <div key={h._id}>
              {h.actor} — {h.action}{" "}
              <small>{new Date(h.createdAt).toLocaleString()}</small>
            </div>
          ))}
        </>
      )}
    </>
  );
}
function Citizen() {
  const [f, setF] = useState({
    name: "",
    city: "",
    state: "",
    eventType: "Flood",
    description: "",
    latitude: "",
    longitude: "",
  });
  const [msg, setMsg] = useState();
  const [locating, setLocating] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = (e) => {
    e.preventDefault();
    api("/citizen-report", { method: "POST", body: f })
      .then((r) => setMsg("Submitted. Status: " + r.status))
      .catch((e) => setMsg(e.message));
  };
  const locate = () => {
    setLocating(true);
    setMsg();
    getGeo()
      .then(async ({ lat, lon }) => {
        setF((cur) => ({ ...cur, latitude: lat, longitude: lon }));
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`,
          );
          const j = await r.json();
          const a = j.address || {};
          setF((cur) => ({
            ...cur,
            latitude: lat,
            longitude: lon,
            city: cur.city || a.city || a.town || a.county || "",
            state: cur.state || a.state || "",
          }));
        } catch {
          /* GPS coords still captured even if the place lookup fails */
        }
      })
      .catch((e) => setMsg(e.message))
      .finally(() => setLocating(false));
  };
  return (
    <form className="card" onSubmit={go}>
      <h2>Report weather event</h2>
      <button
        type="button"
        className="btn alt"
        disabled={locating}
        onClick={locate}
      >
        {locating ? "Locating…" : "Use my current location"}
      </button>
      {f.latitude && (
        <small>
          GPS captured: {(+f.latitude).toFixed(3)}, {(+f.longitude).toFixed(3)}
        </small>
      )}
      <input placeholder="Name" value={f.name} onChange={set("name")} />
      <input
        placeholder="City (e.g. Bhilai)"
        value={f.city}
        onChange={set("city")}
      />
      <input placeholder="State" value={f.state} onChange={set("state")} />
      <select value={f.eventType} onChange={set("eventType")}>
        {Object.keys(EV).map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>
      <textarea
        rows="4"
        placeholder="Describe what you see"
        value={f.description}
        onChange={set("description")}
      />
      <button className="btn">Submit report</button>
      {msg && <b>{msg}</b>}
    </form>
  );
}
function About() {
  return (
    <>
      <h2>Data flow</h2>
      <div className="arch">
        {[
          "Data sources (IMD, weather APIs, news, citizens)",
          "Collection APIs",
          "Node.js / Express",
          "Cleaning → duplicate detection",
          "AI/ML classification",
          "Cross-source verification",
          "MongoDB",
          "REST API",
          "React dashboard",
        ].map((t) => (
          <div key={t}>{t}</div>
        ))}
      </div>
      <p>
        AI-assisted verification is advisory. Source reliability is scored per
        report, never per platform.
      </p>
    </>
  );
}
function Login({ done }) {
  const [e, setE] = useState("admin@weathershield.in"),
    [p, setP] = useState("demo1234");
  return (
    <form
      className="card"
      style={{ maxWidth: 360 }}
      onSubmit={(ev) => {
        ev.preventDefault();
        api("/auth/login", { method: "POST", body: { email: e, password: p } })
          .then((r) => {
            TOKEN = r.token;
            done(r);
          })
          .catch((x) => alert(x.message));
      }}
    >
      <h2>Admin sign in</h2>
      <input value={e} onChange={(x) => setE(x.target.value)} />
      <input type="password" value={p} onChange={(x) => setP(x.target.value)} />
      <button className="btn">Sign in</button>
      <small>Demo: admin@ / analyst@weathershield.in, password demo1234</small>
    </form>
  );
}
export default function App() {
  const [p, setP] = useState("dash");
  const [user, setUser] = useState();
  const nav = [
    ["dash", "Dashboard"],
    ["reports", "Live Reports"],
    ["map", "Weather Map"],
    ["analytics", "Analytics"],
    ["center", "Verification Center"],
    ["admin", "Admin Panel"],
    ["citizen", "Report"],
    ["about", "About"],
  ];
  const adm = user?.role === "Admin" || user?.role === "Analyst";
  const pages = {
    dash: <Dash go={setP} />,
    reports: <Reports admin={adm} />,
    map: <MapView />,
    analytics: <Analytics />,
    center: <Center admin={adm} />,
    citizen: <Citizen />,
    about: <About />,
    admin: adm ? (
      <>
        <p>
          Signed in as {user.email} ({user.role}). Use Verify/Reject in Live
          Reports; every action is logged in Verification Center.
        </p>
        <Reports admin />
      </>
    ) : (
      <Login done={setUser} />
    ),
  };
  return (
    <>
      <header>
        <b>WeatherShield India</b>
        <nav>
          {nav.map(([k, l]) => (
            <button
              key={k}
              className={p === k ? "on" : ""}
              onClick={() => setP(k)}
            >
              {l}
            </button>
          ))}
        </nav>
      </header>
      <main>{pages[p]}</main>
    </>
  );
}
