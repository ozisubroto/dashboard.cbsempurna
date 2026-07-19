import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "30mb" }));

/* ============================================================
   PERSISTENT DATA STORAGE
   - DATA_DIR should point to a Railway Volume mount (e.g. /data)
     so uploaded data survives redeploys. If no volume is attached,
     this falls back to a local folder that survives restarts but
     resets on the next deploy.
   - On first boot, the store is seeded from the file shipped in
     public/data/dashboard-data.json.
   ============================================================ */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "dashboard-data.json");
const SEED_FILE = path.join(__dirname, "public", "data", "dashboard-data.json");
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || "cbs-admin-2026";

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    if (fs.existsSync(SEED_FILE)) {
      fs.copyFileSync(SEED_FILE, DATA_FILE);
      console.log("[data] Seeded persistent store from public/data/dashboard-data.json");
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ dicts: {}, prodMeta: { brand: [], kat: [] }, tx: {}, tgt: {} }));
      console.log("[data] No seed file found, created an empty store");
    }
  }
}
ensureDataFile();

/* ---------- API ---------- */
app.get("/api/data", (req, res) => {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    res.type("application/json").send(raw);
  } catch (err) {
    res.status(500).json({ error: "Gagal membaca data: " + err.message });
  }
});

app.post("/api/data", (req, res) => {
  const token = req.headers["x-upload-token"];
  if (!UPLOAD_TOKEN || token !== UPLOAD_TOKEN) {
    return res.status(401).json({ error: "Token upload tidak valid." });
  }
  const body = req.body;
  if (!body || !body.dicts || !body.tx || !body.tgt) {
    return res.status(400).json({ error: "Struktur data tidak sesuai." });
  }
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(body));
    res.json({
      ok: true,
      txCount: (body.tx.ym || []).length,
      tgtCount: (body.tgt.ym || []).length,
    });
  } catch (err) {
    res.status(500).json({ error: "Gagal menyimpan data: " + err.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, dataFile: DATA_FILE, hasVolume: DATA_DIR !== path.join(__dirname, "data") });
});

/* ---------- Static frontend ---------- */
const DIST_DIR = path.join(__dirname, "dist");
app.use(express.static(DIST_DIR));
app.get("*", (req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Persistent data file: ${DATA_FILE}`);
  console.log(DATA_DIR.startsWith(__dirname) ? "WARNING: no DATA_DIR volume configured, data resets on redeploy." : "DATA_DIR volume configured.");
});
