require("dotenv").config();
const path = require("path"),
  fs = require("fs");
const express = require("express"),
  cors = require("cors"),
  mongoose = require("mongoose"),
  jwt = require("jsonwebtoken"),
  bcrypt = require("bcryptjs");
const M = require("./models"),
  V = require("./verify"),
  EXT = require("./external");
const R = M.WeatherReport;
const SECRET = process.env.JWT_SECRET || "dev-secret";
const app = express();
app.use(cors(), express.json());
const auth =
  (roles = []) =>
  (req, res, next) => {
    try {
      const u = jwt.verify((req.headers.authorization || "").slice(7), SECRET);
      if (roles.length && !roles.includes(u.role))
        return res.status(403).json({ error: "Forbidden" });
      req.user = u;
      next();
    } catch {
      res.status(401).json({ error: "Login required" });
    }
  };
const w = (f) => (req, res) =>
  f(req, res).catch((e) => res.status(500).json({ error: e.message }));
const log = (req, id, action, status) =>
  M.Verification.create({
    reportId: id,
    actor: req.user.email,
    action,
    status,
  });
app.post(
  "/api/auth/login",
  w(async (req, res) => {
    const u = await M.User.findOne({ email: String(req.body.email) });
    if (!u || !bcrypt.compareSync(req.body.password || "", u.passwordHash))
      return res.status(401).json({ error: "Invalid credentials" });
    res.json({
      token: jwt.sign({ email: u.email, role: u.role }, SECRET, {
        expiresIn: "8h",
      }),
      role: u.role,
      email: u.email,
    });
  }),
);
app.get(
  "/api/reports",
  w(async (req, res) => {
    const q = {};

    const {
      state,
      city,
      event,
      status,
      source,
      search,
      from,
      to,
      page = 1,
      limit = 20,
      sort = "-timestamp",
    } = req.query;

    if (state) q["location.state"] = state;
    if (city) q["location.city"] = city;
    if (event) q.eventType = event;
    if (status) q.verificationStatus = status;
    if (source) q.sourceType = source;

    if (search) {
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      q.reportText = new RegExp(safe, "i");
    }

    // Date/time filtering
    if (from || to) {
      q.timestamp = {};

      if (from) {
        q.timestamp.$gte = new Date(from);
      }

      if (to) {
        const end = new Date(to);

        end.setHours(23, 59, 59, 999);

        q.timestamp.$lte = end;
      }
    }

    const currentPage = Math.max(Number(page) || 1, 1);
    const perPage = Math.min(Math.max(Number(limit) || 20, 1), 100);

    const [items, total] = await Promise.all([
      R.find(q)
        .sort(sort)
        .skip((currentPage - 1) * perPage)
        .limit(perPage),

      R.countDocuments(q),
    ]);

    res.json({
      items,
      total,
      page: currentPage,
      limit: perPage,
      pages: Math.ceil(total / perPage),
    });
  }),
);
app.get('/api/analytics', w(async (req, res) => {
  const [
    total,
    byEvent,
    bySource,
    byStatus
  ] = await Promise.all([
    R.countDocuments(),

    R.aggregate([
      {
        $group: {
          _id: '$eventType',
          n: { $sum: 1 }
        }
      },
      {
        $sort: { n: -1 }
      }
    ]),

    R.aggregate([
      {
        $group: {
          _id: '$sourceType',
          n: { $sum: 1 }
        }
      },
      {
        $sort: { n: -1 }
      }
    ]),

    R.aggregate([
      {
        $group: {
          _id: '$verificationStatus',
          n: { $sum: 1 }
        }
      },
      {
        $sort: { n: -1 }
      }
    ])
  ]);

  const statusCounts = Object.fromEntries(
    byStatus.map((x) => [x._id, x.n])
  );

  const verified = statusCounts.Verified || 0;

  const verificationRate =
    total === 0
      ? 0
      : Math.round((verified / total) * 100);

  res.json({
    total,
    verified,
    verificationRate,
    byEvent,
    bySource,
    byStatus
  });
}));
app.get(
  "/api/reports/location/:city",
  w(async (req, res) =>
    res.json(
      await R.find({ "location.city": req.params.city }).sort("-timestamp"),
    ),
  ),
);
app.get(
  "/api/reports/:id",
  w(async (req, res) => {
    const r = await R.findById(req.params.id);
    if (!r) return res.sendStatus(404);
    const g = await R.find({
      duplicateGroupId: r.duplicateGroupId,
      _id: { $ne: r._id },
    });
    res.json({
      report: r,
      related: g,
      duplicates: g.filter(
        (x) => V.similarity(x.reportText, r.reportText) > 0.3,
      ),
      conflicts: g.filter(
        (x) => V.negates(x.reportText) !== V.negates(r.reportText),
      ),
      history: await M.Verification.find({ reportId: r._id }).sort(
        "-createdAt",
      ),
    });
  }),
);
const ingest = async (b) => {
  const eventType = b.eventType || V.classify(b.reportText),
    group = `${b.location.city}-${eventType}`;
  const d = await R.create({
    ...b,
    eventType,
    duplicateGroupId: group,
    timestamp: b.timestamp || new Date(),
  });
  const all = await R.find({ duplicateGroupId: group });
  const o = V.evaluate(all);
  await R.updateMany(
    { duplicateGroupId: group, manual: { $ne: true } },
    {
      confidenceScore: o.conf,
      verificationStatus: o.status,
      aiReason: o.reason,
    },
  );
  await M.WeatherEvent.findOneAndUpdate(
    { eventType, "location.city": b.location.city },
    {
      eventType,
      location: b.location,
      status: o.status,
      confidence: o.conf,
      sources: o.evidence,
      reportCount: all.length,
    },
    { upsert: true },
  );
  return R.findById(d._id);
};
app.post(
  "/api/reports",
  auth(["Admin", "Analyst"]),
  w(async (req, res) => {
    if (!req.body.reportText || !req.body.location?.city)
      return res
        .status(400)
        .json({ error: "reportText and location.city required" });
    res
      .status(201)
      .json(await ingest({ sourceType: "Social", ...req.body, isDemo: false }));
  }),
);
app.put(
  "/api/reports/:id",
  auth(["Admin"]),
  w(async (req, res) => {
    const r = await R.findByIdAndUpdate(
      req.params.id,
      { eventType: req.body.eventType },
      { new: true },
    );
    await log(req, r._id, "Changed event category", r.verificationStatus);
    res.json(r);
  }),
);
app.delete(
  "/api/reports/:id",
  auth(["Admin"]),
  w(async (req, res) => {
    await R.findByIdAndDelete(req.params.id);
    res.sendStatus(204);
  }),
);
app.post(
  "/api/verify/:id",
  auth(["Admin", "Analyst"]),
  w(async (req, res) => {
    if (
      ![
        "Verified",
        "Partially Verified",
        "Unverified",
        "Conflicting",
        "Under Review",
        "Rejected",
      ].includes(req.body.status)
    )
      return res.status(400).json({ error: "Invalid status" });
    const r = await R.findByIdAndUpdate(
      req.params.id,
      { verificationStatus: req.body.status, manual: true },
      { new: true },
    );
    await log(
      req,
      r._id,
      `Marked report as ${req.body.status}`,
      req.body.status,
    );
    res.json(r);
  }),
);
app.post(
  "/api/citizen-report",
  w(async (req, res) => {
    const b = req.body;
    if (!b.description || !b.city || !b.name)
      return res
        .status(400)
        .json({ error: "name, city, description required" });
    const r = await ingest({
      sourceName: "Citizen Report",
      sourceType: "Citizen",
      reportText: b.description,
      eventType: b.eventType,
      location: {
        city: b.city,
        state: b.state,
        latitude: b.latitude,
        longitude: b.longitude,
      },
      media: b.mediaUrl ? [b.mediaUrl] : [],
      isDemo: false,
    });
    await R.findByIdAndUpdate(r._id, {
      verificationStatus: "Under Review",
      manual: true,
    });
    await M.CitizenReport.create({ ...b, reportId: r._id });
    res.status(201).json({ id: r._id, status: "Under Review" });
  }),
);
app.get("/api/live-status", (_, res) =>
  res.json({
    weather: !!process.env.OPENWEATHER_KEY,
    news: !!process.env.NEWS_API_KEY,
  }),
);
app.get(
  "/api/weather-here",
  w(async (req, res) => {
    const { lat, lon } = req.query;
    if (!lat || !lon)
      return res.status(400).json({ error: "lat and lon required" });
    if (!process.env.OPENWEATHER_KEY)
      return res
        .status(400)
        .json({ error: "OPENWEATHER_KEY not configured on the server." });
    res.json(await EXT.fetchWeatherAt(lat, lon));
  }),
);
app.post(
  "/api/refresh-live",
  w(async (req, res) => res.json(await EXT.refreshLive(ingest))),
);
app.get(
  "/api/events",
  w(async (_, res) =>
    res.json(await M.WeatherEvent.find().sort("-confidence")),
  ),
);
app.get(
  "/api/sources",
  w(async (_, res) => res.json(await M.Source.find())),
);
app.get(
  "/api/alerts",
  w(async (_, res) => res.json(await M.Alert.find().sort("-createdAt"))),
);
app.get(
  "/api/audit",
  auth(["Admin", "Analyst"]),
  w(async (_, res) =>
    res.json(await M.Verification.find().sort("-createdAt").limit(50)),
  ),
);

const distPath = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^\/(?!api).*/, (_, res) =>
    res.sendFile(path.join(distPath, "index.html")),
  );
}
mongoose
  .connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/weathershield")
  .then(async () => {
    if (!process.env.SKIP_SEED && !(await R.countDocuments()))
      await require("./seed")();
    app.listen(process.env.PORT || 5000, () =>
      console.log(
        "API :" +
          (process.env.PORT || 5000) +
          (process.env.SKIP_SEED
            ? " (seeding skipped)"
            : " (demo data seeded)"),
      ),
    );
  });
