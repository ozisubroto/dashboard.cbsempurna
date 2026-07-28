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
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.type("application/json").send(raw);
  } catch (err) {
    res.status(500).json({ error: "Gagal membaca data: " + err.message });
  }
});

app.post("/api/data", (req, res) => {
  const token = req.headers["x-upload-token"];
  if (!UPLOAD_TOKEN || token !== UPLOAD_TOKEN) {
    console.log("[upload] REJECTED: invalid token");
    return res.status(401).json({ error: "Token upload tidak valid." });
  }
  const body = req.body;
  if (!body || !body.dicts || !body.tx || !body.tgt) {
    console.log("[upload] REJECTED: invalid structure", body ? Object.keys(body) : body);
    return res.status(400).json({ error: "Struktur data tidak sesuai." });
  }
  try {
    const years = body.dicts.ym || [];
    console.log(`[upload] Saving new data: tx=${(body.tx.ym||[]).length} rows, tgt=${(body.tgt.ym||[]).length} rows, periods=${years[0]}..${years[years.length-1]} (${years.length} total)`);
    fs.writeFileSync(DATA_FILE, JSON.stringify(body));
    console.log("[upload] Saved successfully to", DATA_FILE);
    res.json({
      ok: true,
      txCount: (body.tx.ym || []).length,
      tgtCount: (body.tgt.ym || []).length,
    });
  } catch (err) {
    console.log("[upload] ERROR while saving:", err.message);
    res.status(500).json({ error: "Gagal menyimpan data: " + err.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, dataFile: DATA_FILE, hasVolume: DATA_DIR !== path.join(__dirname, "data") });
});

/* ============================================================
   AI AGENT (Groq API proxy)
   - Keeps GROQ_API_KEY secret on the server; the browser never
     sees it.
   - Frontend sends { question, context, history }, where
     `context` is a small pre-computed JSON summary of the
     currently-filtered dashboard data (NOT the full dataset).
   - Simple in-memory rate limit per IP to keep free-tier usage
     (and cost, if you switch to a paid model later) in check.
   ============================================================ */
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 12; // max requests per IP per minute
const rateLimitMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_LIMIT_WINDOW_MS; }
  entry.count += 1;
  rateLimitMap.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}

const SYSTEM_PROMPT = `Kamu adalah "CBS Sales Assistant", asisten analisis data untuk dashboard penjualan PT. Cahaya Bintang Sempurna (distributor produk kecantikan: Bioaqua, Kojiesan, My BestFriend, Nature Dradiance).

Kamu akan diberi ringkasan data (JSON) hasil filter yang sedang aktif di dashboard. Jawab pertanyaan pengguna HANYA berdasarkan data yang diberikan di dalam tag <data> - jangan mengarang angka yang tidak ada di situ.
Jika data yang dibutuhkan untuk menjawab tidak tersedia dalam ringkasan yang diberikan, katakan dengan jujur bahwa datanya tidak tersedia pada ringkasan saat ini, jangan menebak.
Jawab singkat, langsung ke inti, dalam Bahasa Indonesia. Gunakan format Rupiah yang wajar (contoh: Rp 1,2 M / Rp 850 Jt). Kalau relevan, beri 1 rekomendasi tindak lanjut singkat di akhir jawaban.`;

app.post("/api/ai/chat", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Terlalu banyak pertanyaan dalam waktu singkat, coba lagi sebentar lagi." });
  }
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY belum diatur di server (environment variable)." });
  }
  const { question, context, history } = req.body || {};
  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Pertanyaan tidak boleh kosong." });
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `<data>${JSON.stringify(context || {})}</data>` },
    ...(Array.isArray(history) ? history.slice(-6) : []),
    { role: "user", content: question },
  ];

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: 0.3,
        max_tokens: 600,
      }),
    });
    const data = await groqRes.json();
    if (!groqRes.ok) {
      console.log("[ai] Groq error:", JSON.stringify(data).slice(0, 500));
      return res.status(groqRes.status).json({ error: data.error?.message || "Groq API mengembalikan error." });
    }
    const answer = data.choices?.[0]?.message?.content || "(Tidak ada jawaban.)";
    res.json({ answer });
  } catch (err) {
    console.log("[ai] ERROR:", err.message);
    res.status(500).json({ error: "Gagal menghubungi Groq API: " + err.message });
  }
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
