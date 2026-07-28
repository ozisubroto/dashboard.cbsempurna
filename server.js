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
   AI AGENT (Groq API proxy, with tool-calling)
   - Keeps GROQ_API_KEY secret on the server; the browser never
     sees it.
   - Frontend sends { question, context, history }, where
     `context` is a small pre-computed JSON summary (national
     totals per brand/region, monthly, top kota/produk).
   - For anything more specific (a single kota + month, product
     breakdown, month-over-month drivers), the model calls a
     "tool" and this server executes it directly against the
     stored dataset (DATA_FILE) and feeds the result back.
   - Simple in-memory rate limit per IP to keep free-tier usage
     (and cost, if you switch to a paid model later) in check.
   ============================================================ */
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

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

function loadRawData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

function findIndexLoose(list, needle) {
  if (!needle) return -1;
  const n = String(needle).trim().toLowerCase();
  let idx = list.findIndex(v => String(v).toLowerCase() === n);
  if (idx === -1) idx = list.findIndex(v => String(v).toLowerCase().includes(n));
  return idx;
}

/* Tool 1: detail penjualan 1 kota pada 1 bulan tertentu, termasuk breakdown
   produk dan produk-produk yang paling mendorong kenaikan/penurunan
   dibanding bulan sebelumnya. */
function toolGetKotaBulanDetail({ kota, bulan, tahun, trx }) {
  const raw = loadRawData();
  const d = raw.dicts;
  const kotaIdx = findIndexLoose(d.kota, kota);
  if (kotaIdx === -1) return { error: `Kota "${kota}" tidak ditemukan di data.` };
  const trxLabel = /out/i.test(trx) ? "Selling Out" : "Selling In";
  const trxIdx = d.trx.indexOf(trxLabel);

  const bulanNum = Math.max(1, Math.min(12, parseInt(bulan, 10) || 1));
  const targetYm = `${tahun}-${String(bulanNum).padStart(2, "0")}`;
  let prevYear = parseInt(tahun, 10), prevMonth = bulanNum - 1;
  if (prevMonth < 1) { prevMonth = 12; prevYear -= 1; }
  const prevYm = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
  const targetYmIdx = d.ym.indexOf(targetYm);
  const prevYmIdx = d.ym.indexOf(prevYm);

  const tx = raw.tx;
  const curByProd = new Map(), prevByProd = new Map();
  let curTotal = 0, prevTotal = 0;
  for (let i = 0; i < tx.ym.length; i++) {
    if (tx.kota[i] !== kotaIdx || tx.trx[i] !== trxIdx) continue;
    const prodLabel = d.prod[tx.prod[i]];
    if (tx.ym[i] === targetYmIdx) {
      curByProd.set(prodLabel, (curByProd.get(prodLabel) || 0) + tx.amt[i]);
      curTotal += tx.amt[i];
    } else if (tx.ym[i] === prevYmIdx) {
      prevByProd.set(prodLabel, (prevByProd.get(prodLabel) || 0) + tx.amt[i]);
      prevTotal += tx.amt[i];
    }
  }
  if (targetYmIdx === -1) return { error: `Bulan ${targetYm} tidak ada di data.` };

  const topProduk = Array.from(curByProd.entries())
    .map(([nama, value]) => ({ nama, value: Math.round(value), kontribusi_persen: curTotal > 0 ? +((value / curTotal) * 100).toFixed(1) : 0 }))
    .sort((a, b) => b.value - a.value).slice(0, 10);

  const allProd = new Set([...curByProd.keys(), ...prevByProd.keys()]);
  const drivers = Array.from(allProd).map(nama => {
    const cur = curByProd.get(nama) || 0, prev = prevByProd.get(nama) || 0;
    return { nama, bulan_ini: Math.round(cur), bulan_lalu: Math.round(prev), perubahan: Math.round(cur - prev) };
  }).sort((a, b) => Math.abs(b.perubahan) - Math.abs(a.perubahan)).slice(0, 8);

  return {
    kota: d.kota[kotaIdx],
    kategori_trx: trxLabel,
    bulan_ini: { periode: `${MONTH_NAMES[bulanNum - 1]} ${tahun}`, total: Math.round(curTotal) },
    bulan_lalu: prevYmIdx === -1 ? null : { periode: `${MONTH_NAMES[prevMonth - 1]} ${prevYear}`, total: Math.round(prevTotal) },
    perubahan_persen: prevTotal > 0 ? +(((curTotal - prevTotal) / prevTotal) * 100).toFixed(1) : null,
    top_produk_bulan_ini: topProduk,
    produk_pendorong_perubahan: drivers,
  };
}

/* Tool 2: detail 1 produk pada 1 bulan tertentu, breakdown per kota. */
function toolGetProdukBulanDetail({ produk, bulan, tahun, trx }) {
  const raw = loadRawData();
  const d = raw.dicts;
  const prodIdx = findIndexLoose(d.prod, produk);
  if (prodIdx === -1) return { error: `Produk "${produk}" tidak ditemukan di data.` };
  const trxLabel = /out/i.test(trx) ? "Selling Out" : "Selling In";
  const trxIdx = d.trx.indexOf(trxLabel);
  const bulanNum = Math.max(1, Math.min(12, parseInt(bulan, 10) || 1));
  const targetYm = `${tahun}-${String(bulanNum).padStart(2, "0")}`;
  const targetYmIdx = d.ym.indexOf(targetYm);
  if (targetYmIdx === -1) return { error: `Bulan ${targetYm} tidak ada di data.` };

  const tx = raw.tx;
  const byKota = new Map();
  let total = 0, qty = 0;
  for (let i = 0; i < tx.ym.length; i++) {
    if (tx.prod[i] !== prodIdx || tx.trx[i] !== trxIdx || tx.ym[i] !== targetYmIdx) continue;
    const kotaLabel = d.kota[tx.kota[i]];
    byKota.set(kotaLabel, (byKota.get(kotaLabel) || 0) + tx.amt[i]);
    total += tx.amt[i]; qty += tx.qty[i];
  }
  const topKota = Array.from(byKota.entries())
    .map(([nama, value]) => ({ nama, value: Math.round(value), kontribusi_persen: total > 0 ? +((value / total) * 100).toFixed(1) : 0 }))
    .sort((a, b) => b.value - a.value).slice(0, 10);

  return {
    produk: d.prod[prodIdx],
    kategori_trx: trxLabel,
    periode: `${MONTH_NAMES[bulanNum - 1]} ${tahun}`,
    total_value: Math.round(total),
    total_qty: Math.round(qty),
    top_kota: topKota,
  };
}

/* Tool 4: ranking kota (opsional difilter per region) berdasarkan besarnya
   kenaikan/penurunan dibanding bulan sebelumnya, lengkap produk pendorong
   tiap kota. Ini menjawab pertanyaan seperti "kota mana yang paling turun
   di region Central" secara presisi dan sudah difilter arah perubahannya -
   bukan tebakan dari nama kota di percakapan sebelumnya. */
function toolGetKotaRankingPerubahan({ region, trx, tahun, bulan, arah, top_n }) {
  const raw = loadRawData();
  const d = raw.dicts;
  const trxLabel = /out/i.test(trx) ? "Selling Out" : "Selling In";
  const trxIdx = d.trx.indexOf(trxLabel);
  const regionIdx = region ? findIndexLoose(d.reg, region) : -1;
  if (region && regionIdx === -1) return { error: `Region "${region}" tidak ditemukan.` };

  const bulanNum = Math.max(1, Math.min(12, parseInt(bulan, 10) || 1));
  const targetYm = `${tahun}-${String(bulanNum).padStart(2, "0")}`;
  let prevYear = parseInt(tahun, 10), prevMonth = bulanNum - 1;
  if (prevMonth < 1) { prevMonth = 12; prevYear -= 1; }
  const prevYm = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
  const targetYmIdx = d.ym.indexOf(targetYm);
  const prevYmIdx = d.ym.indexOf(prevYm);
  if (targetYmIdx === -1) return { error: `Bulan ${targetYm} tidak ada di data.` };

  const tx = raw.tx;
  const curByKota = new Map(), prevByKota = new Map();
  const curProdByKota = new Map(), prevProdByKota = new Map();

  for (let i = 0; i < tx.ym.length; i++) {
    if (tx.trx[i] !== trxIdx) continue;
    if (regionIdx !== -1 && tx.reg[i] !== regionIdx) continue;
    const isCur = tx.ym[i] === targetYmIdx;
    const isPrev = tx.ym[i] === prevYmIdx;
    if (!isCur && !isPrev) continue;
    const kotaLabel = d.kota[tx.kota[i]];
    const prodLabel = d.prod[tx.prod[i]];
    const byKota = isCur ? curByKota : prevByKota;
    const prodByKota = isCur ? curProdByKota : prevProdByKota;
    byKota.set(kotaLabel, (byKota.get(kotaLabel) || 0) + tx.amt[i]);
    if (!prodByKota.has(kotaLabel)) prodByKota.set(kotaLabel, new Map());
    const m = prodByKota.get(kotaLabel);
    m.set(prodLabel, (m.get(prodLabel) || 0) + tx.amt[i]);
  }

  const allKota = new Set([...curByKota.keys(), ...prevByKota.keys()]);
  let list = Array.from(allKota).map(kota => {
    const cur = curByKota.get(kota) || 0, prev = prevByKota.get(kota) || 0;
    const delta = cur - prev;
    const deltaPersen = prev > 0 ? (delta / prev) * 100 : (cur > 0 ? 100 : 0);
    return { kota, bulan_ini: Math.round(cur), bulan_lalu: Math.round(prev), perubahan: Math.round(delta), perubahan_persen: +deltaPersen.toFixed(1) };
  });

  if (arah === "turun") list = list.filter(k => k.perubahan < 0).sort((a, b) => a.perubahan - b.perubahan);
  else if (arah === "naik") list = list.filter(k => k.perubahan > 0).sort((a, b) => b.perubahan - a.perubahan);
  else list.sort((a, b) => Math.abs(b.perubahan) - Math.abs(a.perubahan));

  const n = Math.max(1, Math.min(10, parseInt(top_n, 10) || 5));
  list = list.slice(0, n).map(item => {
    const curMap = curProdByKota.get(item.kota) || new Map();
    const prevMap = prevProdByKota.get(item.kota) || new Map();
    const allProd = new Set([...curMap.keys(), ...prevMap.keys()]);
    const drivers = Array.from(allProd).map(p => {
      const c = curMap.get(p) || 0, pv = prevMap.get(p) || 0;
      return { produk: p, perubahan: Math.round(c - pv) };
    }).sort((a, b) => Math.abs(b.perubahan) - Math.abs(a.perubahan)).slice(0, 3);
    return { ...item, produk_pendorong: drivers };
  });

  if (list.length === 0) return { info: "Tidak ada kota yang cocok dengan filter arah perubahan ini pada periode tersebut.", kota: [] };

  return {
    kategori_trx: trxLabel,
    region: region || "semua region",
    bulan_ini: `${MONTH_NAMES[bulanNum - 1]} ${tahun}`,
    bulan_lalu: prevYmIdx === -1 ? null : `${MONTH_NAMES[prevMonth - 1]} ${prevYear}`,
    arah_filter: arah || "semua",
    kota: list,
  };
}

/* Tool 3: total presisi untuk satu rentang bulan (mis. YTD Jan-Mei), opsional
   difilter per region dan/atau brand. Dihitung persis di server (bukan
   dijumlahkan oleh model AI) supaya tidak salah hitung. */
function toolGetPeriodeTotal({ trx, tahun, bulan_awal, bulan_akhir, region, brand }) {
  const raw = loadRawData();
  const d = raw.dicts;
  const trxLabel = /out/i.test(trx) ? "Selling Out" : "Selling In";
  const trxIdx = d.trx.indexOf(trxLabel);
  const bStart = Math.max(1, Math.min(12, parseInt(bulan_awal, 10) || 1));
  const bEnd = Math.max(bStart, Math.min(12, parseInt(bulan_akhir, 10) || 12));

  const validYmIdx = new Set();
  for (let m = bStart; m <= bEnd; m++) {
    const idx = d.ym.indexOf(`${tahun}-${String(m).padStart(2, "0")}`);
    if (idx !== -1) validYmIdx.add(idx);
  }
  const regionIdx = region ? findIndexLoose(d.reg, region) : -1;
  if (region && regionIdx === -1) return { error: `Region "${region}" tidak ditemukan.` };

  const tx = raw.tx;
  let total = 0, qty = 0;
  for (let i = 0; i < tx.ym.length; i++) {
    if (tx.trx[i] !== trxIdx) continue;
    if (!validYmIdx.has(tx.ym[i])) continue;
    if (regionIdx !== -1 && tx.reg[i] !== regionIdx) continue;
    if (brand) {
      const brandLabel = d.brand[raw.prodMeta.brand[tx.prod[i]]];
      if (!brandLabel.toLowerCase().includes(String(brand).toLowerCase())) continue;
    }
    total += tx.amt[i];
    qty += tx.qty[i];
  }
  return {
    kategori_trx: trxLabel,
    tahun,
    rentang_bulan: bStart === bEnd ? MONTH_NAMES[bStart - 1] : `${MONTH_NAMES[bStart - 1]}-${MONTH_NAMES[bEnd - 1]}`,
    filter_region: region || "semua region",
    filter_brand: brand || "semua brand",
    total_value: Math.round(total),
    total_qty: Math.round(qty),
  };
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_kota_ranking_perubahan",
      description: "Ranking kota (opsional difilter dalam satu region tertentu) berdasarkan besarnya PERUBAHAN (naik atau turun) dibanding bulan sebelumnya, lengkap produk pendorong tiap kota. WAJIB pakai tool ini untuk pertanyaan seperti 'kota mana yang paling turun/naik di region X' - JANGAN menebak nama kota dari percakapan sebelumnya, dan JANGAN campur kota dari region lain. Kalau user cuma minta yang turun, isi arah='turun' supaya kota yang naik tidak ikut disebutkan.",
      parameters: {
        type: "object",
        properties: {
          region: { type: "string", description: "Opsional: nama region (Central/East/West/MT/HO/Online) untuk memfilter kota. Kosongkan untuk semua region." },
          trx: { type: "string", enum: ["Selling In", "Selling Out"] },
          tahun: { type: "integer", description: "Tahun 4 digit, contoh 2026" },
          bulan: { type: "integer", description: "Bulan yang ditanyakan, 1-12" },
          arah: { type: "string", enum: ["turun", "naik", "semua"], description: "'turun' = hanya kota yang mengalami penurunan, 'naik' = hanya yang naik, 'semua' = ranking berdasar besar perubahan tanpa peduli arah" },
          top_n: { type: "integer", description: "Jumlah kota yang ingin ditampilkan, default 5" },
        },
        required: ["trx", "tahun", "bulan", "arah"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_periode_total",
      description: "Hitung total value & qty secara PRESISI untuk satu rentang bulan (misalnya YTD Jan-Mei, atau 1 bulan saja), opsional difilter per region dan/atau brand. WAJIB pakai tool ini untuk pertanyaan soal total/YTD/rentang periode - JANGAN menjumlahkan sendiri dari data ringkasan bulanan karena rawan salah hitung. Untuk membandingkan 2 tahun, panggil tool ini 2 kali (sekali per tahun).",
      parameters: {
        type: "object",
        properties: {
          trx: { type: "string", enum: ["Selling In", "Selling Out"], description: "Kategori transaksi" },
          tahun: { type: "integer", description: "Tahun 4 digit, contoh 2026" },
          bulan_awal: { type: "integer", description: "Bulan awal rentang, 1-12" },
          bulan_akhir: { type: "integer", description: "Bulan akhir rentang, 1-12 (isi sama dengan bulan_awal kalau cuma 1 bulan)" },
          region: { type: "string", description: "Opsional: nama region (Central/East/West/MT/HO/Online) untuk memfilter. Kosongkan untuk semua region." },
          brand: { type: "string", description: "Opsional: nama brand untuk memfilter. Kosongkan untuk semua brand." },
        },
        required: ["trx", "tahun", "bulan_awal", "bulan_akhir"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_kota_bulan_detail",
      description: "Ambil detail penjualan satu kota pada satu bulan tertentu: total value, breakdown per produk, dan produk-produk yang paling mendorong kenaikan/penurunan dibanding bulan sebelumnya. Gunakan ini kalau user tanya soal kota tertentu di bulan tertentu.",
      parameters: {
        type: "object",
        properties: {
          kota: { type: "string", description: "Nama kota, contoh: Medan, Bandung, Surabaya" },
          bulan: { type: "integer", description: "Nomor bulan 1-12 (1=Januari, 2=Februari, dst)" },
          tahun: { type: "integer", description: "Tahun 4 digit, contoh 2026" },
          trx: { type: "string", enum: ["Selling In", "Selling Out"], description: "Kategori transaksi" },
        },
        required: ["kota", "bulan", "tahun", "trx"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_produk_bulan_detail",
      description: "Ambil detail penjualan satu produk pada satu bulan tertentu, dengan breakdown per kota. Gunakan ini kalau user tanya soal produk tertentu di bulan tertentu.",
      parameters: {
        type: "object",
        properties: {
          produk: { type: "string", description: "Nama produk (boleh sebagian nama)" },
          bulan: { type: "integer", description: "Nomor bulan 1-12" },
          tahun: { type: "integer", description: "Tahun 4 digit, contoh 2026" },
          trx: { type: "string", enum: ["Selling In", "Selling Out"], description: "Kategori transaksi" },
        },
        required: ["produk", "bulan", "tahun", "trx"],
      },
    },
  },
];

function runTool(name, args) {
  try {
    if (name === "get_kota_ranking_perubahan") return toolGetKotaRankingPerubahan(args);
    if (name === "get_periode_total") return toolGetPeriodeTotal(args);
    if (name === "get_kota_bulan_detail") return toolGetKotaBulanDetail(args);
    if (name === "get_produk_bulan_detail") return toolGetProdukBulanDetail(args);
    return { error: "Tool tidak dikenali: " + name };
  } catch (err) {
    return { error: "Gagal menjalankan tool: " + err.message };
  }
}

const SYSTEM_PROMPT = `Kamu adalah "CBS Sales Assistant", asisten analisis data untuk dashboard penjualan PT. Cahaya Bintang Sempurna (distributor produk kecantikan: Bioaqua, Kojiesan, My BestFriend, Nature Dradiance).

Kamu diberi ringkasan data nasional (JSON di dalam tag <data>): total per brand/region, per bulan, dan top 5 kota/produk. Ringkasan ini HANYA untuk konteks/gambaran umum (misal tren naik/turun) - JANGAN PERNAH menjumlahkan atau mengurangi angka dari ringkasan itu sendiri untuk menjawab pertanyaan soal total/YTD/rentang bulan, karena rawan salah hitung.

ATURAN WAJIB soal angka:
- Untuk PERTANYAAN APA PUN yang butuh total angka (per bulan, YTD, rentang bulan, per region, per brand, per kota, per produk), SELALU panggil tool yang sesuai untuk mendapat angka pasti. Jangan pernah menghitung sendiri dari ringkasan data.
- Untuk pertanyaan "kota/produk mana yang paling naik/turun" (dalam satu region atau secara umum), SELALU pakai get_kota_ranking_perubahan dengan parameter "arah" yang sesuai (turun/naik/semua) - JANGAN pernah menjawab dari nama kota yang kebetulan disebut di percakapan sebelumnya, karena kota itu belum tentu relevan/termasuk region yang ditanyakan sekarang. Setiap pertanyaan baru soal ranking kota/region harus dijawab dengan memanggil tool lagi, bukan mengambil dari jawaban giliran sebelumnya.
- Untuk membandingkan dua periode/tahun, panggil tool yang sesuai sekali untuk masing-masing periode.
- Jangan pernah mengarang angka atau nama kota/produk yang tidak ada di hasil tool/data. Kalau tool mengembalikan error atau daftar kosong, sampaikan itu apa adanya ke user.

Jawab singkat, langsung ke inti, dalam Bahasa Indonesia. Gunakan format Rupiah yang wajar (contoh: Rp 1,2 M / Rp 850 Jt). Kalau relevan, beri 1 rekomendasi tindak lanjut singkat di akhir jawaban.`;

async function callGroq(messages, tools) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      tools,
      tool_choice: tools ? "auto" : undefined,
      temperature: 0.3,
      max_tokens: 700,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || "Groq API mengembalikan error.";
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

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

  let messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `<data>${JSON.stringify(context || {})}</data>` },
    ...(Array.isArray(history) ? history.slice(-6) : []),
    { role: "user", content: question },
  ];

  try {
    let data = await callGroq(messages, TOOLS);
    let rounds = 0;
    while (rounds < 3) {
      const msg = data.choices?.[0]?.message;
      if (!msg || !msg.tool_calls || !msg.tool_calls.length) break;
      messages.push(msg);
      for (const call of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* ignore */ }
        console.log(`[ai] tool call: ${call.function.name}(${JSON.stringify(args)})`);
        const result = runTool(call.function.name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      data = await callGroq(messages, TOOLS);
      rounds += 1;
    }
    const answer = data.choices?.[0]?.message?.content || "(Tidak ada jawaban.)";
    res.json({ answer });
  } catch (err) {
    console.log("[ai] ERROR:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Gagal menghubungi Groq API." });
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
