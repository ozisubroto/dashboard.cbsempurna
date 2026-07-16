import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell
} from "recharts";
import {
  LayoutDashboard, MapPin, Package, Target, Sparkles, UploadCloud,
  LogOut, Lock, User, ChevronDown, X, Search, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight, Building2, Globe2, CheckCircle2, AlertCircle
} from "lucide-react";
import * as XLSX from "xlsx";

/* ============================================================
   EMBEDDED DEFAULT DATASET (factorized / compact)
   ============================================================ */
const DATA_URL = "/data/dashboard-data.json";

/* ============================================================
   CONSTANTS
   ============================================================ */
const MONTHS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
const REGION_ORDER = ["Central","East","West","MT","HO","Online"];
const BRAND_ORDER = ["Bioaqua","Kojiesan","My BestFriend","Nature Dradiance"];
const BRAND_COLORS = {
  "Bioaqua": "#CC9B3B",
  "Kojiesan": "#C0596B",
  "My BestFriend": "#2E7873",
  "Nature Dradiance": "#6B5CA5",
};
const TRX_COLORS = { "Selling In": "#6B5CA5", "Selling Out": "#CC9B3B" };

const USERS = {
  admin: { password: "admin123", role: "admin", name: "Admin CBS" },
  view:  { password: "view123",  role: "view",  name: "Sales Viewer" },
};

/* ============================================================
   FORMATTERS
   ============================================================ */
function formatIDR(v, compact) {
  if (v === null || v === undefined || isNaN(v)) v = 0;
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (compact) {
    if (abs >= 1e9) return sign + "Rp " + (abs / 1e9).toFixed(2).replace(/\.00$/, "") + " M";
    if (abs >= 1e6) return sign + "Rp " + (abs / 1e6).toFixed(1).replace(/\.0$/, "") + " Jt";
    if (abs >= 1e3) return sign + "Rp " + (abs / 1e3).toFixed(0) + " Rb";
    return sign + "Rp " + abs.toFixed(0);
  }
  return sign + "Rp " + Math.round(abs).toLocaleString("id-ID");
}
function formatNum(v) {
  if (v === null || v === undefined || isNaN(v)) v = 0;
  return Math.round(v).toLocaleString("id-ID");
}
function formatPct(v) {
  if (v === null || v === undefined || !isFinite(v)) return "-";
  return v.toFixed(1) + "%";
}

/* ============================================================
   DATA LAYER
   Builds fast lookup structures from the factorized RAW dataset
   and exposes aggregation helpers used by every page.
   ============================================================ */
function buildModel(RAW) {
  const d = RAW.dicts;
  const N = RAW.tx.ym.length;
  const T = RAW.tgt.ym.length;

  const txYear = new Array(N);
  const txMonth = new Array(N);
  for (let i = 0; i < N; i++) {
    const ym = d.ym[RAW.tx.ym[i]];
    txYear[i] = ym.slice(0, 4);
    txMonth[i] = parseInt(ym.slice(5, 7), 10) - 1;
  }
  const tgtYear = new Array(T);
  const tgtMonth = new Array(T);
  for (let i = 0; i < T; i++) {
    const ym = d.ym[RAW.tgt.ym[i]];
    tgtYear[i] = ym.slice(0, 4);
    tgtMonth[i] = parseInt(ym.slice(5, 7), 10) - 1;
  }

  const years = Array.from(new Set(d.ym.map(y => y.slice(0, 4)))).sort();
  const regions = d.reg.slice().sort((a, b) => {
    const ia = REGION_ORDER.indexOf(a), ib = REGION_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const brands = d.brand.slice().sort((a, b) => {
    const ia = BRAND_ORDER.indexOf(a), ib = BRAND_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const kategoris = d.kat.slice().sort();
  const areas = d.area.slice().sort();
  const kotas = d.kota.slice().sort();

  function chanelOfRegionIdx(ri) {
    return d.reg[ri] === "Online" ? "Online" : "Offline";
  }

  return {
    RAW, d, N, T, txYear, txMonth, tgtYear, tgtMonth,
    years, regions, brands, kategoris, areas, kotas, chanelOfRegionIdx,
  };
}

function inSet(set, val) { return !set || set.length === 0 || set.includes(val); }

/* Dashboard: monthly stacked-by-brand series for SI or SO */
function computeDashboardSeries(M, f) {
  const { RAW, d } = M;
  const tx = RAW.tx;
  const sums = {};
  for (let m = 0; m < 12; m++) sums[m] = {};
  let total = 0;
  const monthTotals = new Array(12).fill(0);

  for (let i = 0; i < M.N; i++) {
    if (M.txYear[i] !== f.year) continue;
    const trxLabel = d.trx[tx.trx[i]];
    if (trxLabel !== f.trx) continue;
    const regionLabel = d.reg[tx.reg[i]];
    if (!inSet(f.regions, regionLabel)) continue;
    const areaLabel = d.area[tx.area[i]];
    if (!inSet(f.areas, areaLabel)) continue;
    const kotaLabel = d.kota[tx.kota[i]];
    if (!inSet(f.kotas, kotaLabel)) continue;
    const prodIdx = tx.prod[i];
    const brandLabel = d.brand[RAW.prodMeta.brand[prodIdx]];
    if (!inSet(f.brands, brandLabel)) continue;

    const m = M.txMonth[i];
    const amt = tx.amt[i];
    sums[m][brandLabel] = (sums[m][brandLabel] || 0) + amt;
    total += amt;
    monthTotals[m] += amt;
  }

  const activeBrands = f.brands && f.brands.length ? f.brands.slice() : brandsPresent(sums);
  activeBrands.sort((a, b) => BRAND_ORDER.indexOf(a) - BRAND_ORDER.indexOf(b));

  const chartData = MONTHS.map((label, m) => {
    const row = { month: label };
    activeBrands.forEach(b => { row[b] = Math.round(sums[m][b] || 0); });
    return row;
  });

  const activeMonths = monthTotals.filter(v => v > 0).length;
  const avg = activeMonths ? total / activeMonths : 0;

  return { chartData, activeBrands, total, avg, activeMonths };
}
function brandsPresent(sumsByMonth) {
  const set = new Set();
  Object.values(sumsByMonth).forEach(o => Object.keys(o).forEach(k => set.add(k)));
  const arr = Array.from(set);
  arr.sort((a, b) => BRAND_ORDER.indexOf(a) - BRAND_ORDER.indexOf(b));
  return arr.length ? arr : BRAND_ORDER.slice();
}

/* Performance Kota: rows grouped by region+kota, 12 monthly values */
function computeKotaPerformance(M, f) {
  const { RAW, d } = M;
  const tx = RAW.tx;
  const map = new Map();

  for (let i = 0; i < M.N; i++) {
    if (M.txYear[i] !== f.year) continue;
    const trxLabel = d.trx[tx.trx[i]];
    if (trxLabel !== f.trx) continue;
    const prodIdx = tx.prod[i];
    const brandLabel = d.brand[RAW.prodMeta.brand[prodIdx]];
    if (!inSet(f.brands, brandLabel)) continue;

    const regionLabel = d.reg[tx.reg[i]];
    const kotaLabel = d.kota[tx.kota[i]];
    const key = regionLabel + "|" + kotaLabel;
    if (!map.has(key)) map.set(key, { region: regionLabel, kota: kotaLabel, months: new Array(12).fill(0) });
    map.get(key).months[M.txMonth[i]] += tx.amt[i];
  }

  const rows = Array.from(map.values()).map(r => {
    const total = r.months.reduce((a, b) => a + b, 0);
    const active = r.months.filter(v => v > 0).length;
    return { ...r, total, avg: active ? total / active : 0, active };
  });

  rows.sort((a, b) => {
    const ra = REGION_ORDER.indexOf(a.region), rb = REGION_ORDER.indexOf(b.region);
    if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    return a.kota.localeCompare(b.kota);
  });
  return rows;
}

/* Performance Produk: rows grouped by brand+product, 12 monthly qty & value */
function computeProdukPerformance(M, f) {
  const { RAW, d } = M;
  const tx = RAW.tx;
  const map = new Map();

  for (let i = 0; i < M.N; i++) {
    if (M.txYear[i] !== f.year) continue;
    const trxLabel = d.trx[tx.trx[i]];
    if (trxLabel !== f.trx) continue;
    const chanelLabel = M.chanelOfRegionIdx(tx.reg[i]);
    if (!inSet(f.chanels, chanelLabel)) continue;
    const regionLabel = d.reg[tx.reg[i]];
    if (!inSet(f.regions, regionLabel)) continue;
    const kotaLabel = d.kota[tx.kota[i]];
    if (!inSet(f.kotas, kotaLabel)) continue;
    const areaLabel = d.area[tx.area[i]];
    if (!inSet(f.areas, areaLabel)) continue;

    const prodIdx = tx.prod[i];
    const brandLabel = d.brand[RAW.prodMeta.brand[prodIdx]];
    if (!inSet(f.brands, brandLabel)) continue;
    const katLabel = d.kat[RAW.prodMeta.kat[prodIdx]];
    if (!inSet(f.kategoris, katLabel)) continue;
    const prodLabel = d.prod[prodIdx];

    const key = brandLabel + "|" + prodLabel;
    if (!map.has(key)) map.set(key, {
      brand: brandLabel, produk: prodLabel, kategori: katLabel,
      qtyM: new Array(12).fill(0), amtM: new Array(12).fill(0),
    });
    const row = map.get(key);
    row.qtyM[M.txMonth[i]] += tx.qty[i];
    row.amtM[M.txMonth[i]] += tx.amt[i];
  }

  const rows = Array.from(map.values()).map(r => {
    const totalQty = r.qtyM.reduce((a, b) => a + b, 0);
    const totalAmt = r.amtM.reduce((a, b) => a + b, 0);
    const activeQty = r.qtyM.filter(v => v > 0).length;
    const activeAmt = r.amtM.filter(v => v > 0).length;
    return {
      ...r, totalQty, totalAmt,
      avgQty: activeQty ? totalQty / activeQty : 0,
      avgAmt: activeAmt ? totalAmt / activeAmt : 0,
    };
  });

  rows.sort((a, b) => {
    const ba = BRAND_ORDER.indexOf(a.brand), bb = BRAND_ORDER.indexOf(b.brand);
    if (ba !== bb) return (ba < 0 ? 99 : ba) - (bb < 0 ? 99 : bb);
    return a.produk.localeCompare(b.produk);
  });
  return rows;
}

/* Achievement Target */
function computeAchievement(M, f) {
  const { RAW, d } = M;
  const tx = RAW.tx, tgt = RAW.tgt;

  function pass(regionLabel, areaLabel, kotaLabel) {
    if (!inSet(f.regions, regionLabel)) return false;
    if (!inSet(f.areas, areaLabel)) return false;
    if (!inSet(f.kotas, kotaLabel)) return false;
    return true;
  }
  function monthOk(m) { return f.month === "ALL" || f.month === m; }

  const actual = { "Selling In": 0, "Selling Out": 0 };
  const actualByBrand = {}; BRAND_ORDER.forEach(b => actualByBrand[b] = { "Selling In": 0, "Selling Out": 0 });
  for (let i = 0; i < M.N; i++) {
    if (M.txYear[i] !== f.year) continue;
    if (!monthOk(M.txMonth[i])) continue;
    const regionLabel = d.reg[tx.reg[i]], areaLabel = d.area[tx.area[i]], kotaLabel = d.kota[tx.kota[i]];
    if (!pass(regionLabel, areaLabel, kotaLabel)) continue;
    const trxLabel = d.trx[tx.trx[i]];
    const prodIdx = tx.prod[i];
    const brandLabel = d.brand[RAW.prodMeta.brand[prodIdx]];
    actual[trxLabel] += tx.amt[i];
    if (actualByBrand[brandLabel]) actualByBrand[brandLabel][trxLabel] += tx.amt[i];
  }

  const target = { "Target SI": 0, "Target SO": 0 };
  const targetByBrand = {}; BRAND_ORDER.forEach(b => targetByBrand[b] = { "Target SI": 0, "Target SO": 0 });
  for (let i = 0; i < M.T; i++) {
    if (M.tgtYear[i] !== f.year) continue;
    if (!monthOk(M.tgtMonth[i])) continue;
    const regionLabel = d.reg[tgt.reg[i]], areaLabel = d.area[tgt.area[i]], kotaLabel = d.kota[tgt.kota[i]];
    if (!pass(regionLabel, areaLabel, kotaLabel)) continue;
    const trxLabel = d.trx[tgt.trx[i]];
    const brandLabel = d.brand[tgt.brand[i]];
    target[trxLabel] += tgt.amt[i];
    if (targetByBrand[brandLabel]) targetByBrand[brandLabel][trxLabel] += tgt.amt[i];
  }

  function pack(actualVal, targetVal) {
    const gap = actualVal - targetVal;
    const pct = targetVal > 0 ? (actualVal / targetVal) * 100 : (actualVal > 0 ? 100 : 0);
    return { actual: actualVal, target: targetVal, gap, pct };
  }

  const si = pack(actual["Selling In"], target["Target SI"]);
  const so = pack(actual["Selling Out"], target["Target SO"]);
  const brandBreakdown = BRAND_ORDER.map(b => ({
    brand: b,
    si: pack(actualByBrand[b]["Selling In"], targetByBrand[b]["Target SI"]),
    so: pack(actualByBrand[b]["Selling Out"], targetByBrand[b]["Target SO"]),
  }));

  return { si, so, brandBreakdown };
}

/* Insights page: top kota, top produk, channel mix, yoy trend */
function computeInsights(M, f) {
  const { RAW, d } = M;
  const tx = RAW.tx;
  const kotaMap = new Map();
  const prodMap = new Map();
  const chanelMix = { Offline: 0, Online: 0 };
  const yoy = {};
  M.years.forEach(y => yoy[y] = new Array(12).fill(0));

  for (let i = 0; i < M.N; i++) {
    const trxLabel = d.trx[tx.trx[i]];
    if (trxLabel !== f.trx) continue;
    const year = M.txYear[i];
    const kotaLabel = d.kota[tx.kota[i]];
    const prodIdx = tx.prod[i];
    const prodLabel = d.prod[prodIdx];
    const brandLabel = d.brand[RAW.prodMeta.brand[prodIdx]];
    const amt = tx.amt[i];

    if (year === f.year) {
      kotaMap.set(kotaLabel, (kotaMap.get(kotaLabel) || 0) + amt);
      const pk = brandLabel + " — " + prodLabel;
      prodMap.set(pk, (prodMap.get(pk) || 0) + amt);
      chanelMix[M.chanelOfRegionIdx(tx.reg[i])] += amt;
    }
    if (yoy[year]) yoy[year][M.txMonth[i]] += amt;
  }

  const topKota = Array.from(kotaMap.entries()).map(([k, v]) => ({ name: k, value: v }))
    .sort((a, b) => b.value - a.value).slice(0, 5);
  const topProduk = Array.from(prodMap.entries()).map(([k, v]) => ({ name: k, value: v }))
    .sort((a, b) => b.value - a.value).slice(0, 5);

  const yoyChart = MONTHS.map((label, m) => {
    const row = { month: label };
    M.years.forEach(y => { row[y] = Math.round(yoy[y][m]); });
    return row;
  });

  return { topKota, topProduk, chanelMix, yoyChart };
}

/* ============================================================
   XLSX UPLOAD -> RAW MODEL BUILDER (mirrors the python pipeline)
   ============================================================ */
function excelSerialToYM(v) {
  if (v instanceof Date) {
    return v.getFullYear() + "-" + String(v.getMonth() + 1).padStart(2, "0");
  }
  if (typeof v === "number") {
    const utc = new Date(Math.round((v - 25569) * 86400 * 1000));
    return utc.getUTCFullYear() + "-" + String(utc.getUTCMonth() + 1).padStart(2, "0");
  }
  if (typeof v === "string") {
    const dt = new Date(v);
    if (!isNaN(dt)) return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0");
  }
  return null;
}

function buildRawFromRows(rows) {
  const norm = new Map();
  function canon(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    const key = s.toLowerCase();
    if (!norm.has(key)) norm.set(key, s);
    return norm.get(key);
  }

  const txAgg = new Map();
  const tgtAgg = new Map();
  const prodMetaTmp = new Map();

  for (const r of rows) {
    const ym = excelSerialToYM(r["Bulan"]);
    if (!ym) continue;
    const trx = canon(r["Kategori Trx"]);
    if (!trx) continue;
    const region = canon(r["Region"]) || "Others";
    const area = canon(r["Area"]) || "-";
    const kota = canon(r["Kota"]) || "-";
    const brand = canon(r["Brand"]) || "-";
    const amount = Number(r["Amount"]) || 0;

    if (trx === "Selling In" || trx === "Selling Out") {
      const produk = canon(r["Nama Produk"]) || "-";
      const kategori = canon(r["Kategori"]) || "-";
      const qty = Number(r["Qty"]) || 0;
      if (!prodMetaTmp.has(produk)) prodMetaTmp.set(produk, { brand, kat: kategori });
      const key = [ym, trx, region, kota, area, produk].join("~");
      if (!txAgg.has(key)) txAgg.set(key, { ym, trx, region, kota, area, produk, qty: 0, amt: 0 });
      const row = txAgg.get(key);
      row.qty += qty; row.amt += amount;
    } else if (trx === "Target SI" || trx === "Target SO") {
      const key = [ym, trx, region, area, kota, brand].join("~");
      if (!tgtAgg.has(key)) tgtAgg.set(key, { ym, trx, region, area, kota, brand, amt: 0 });
      tgtAgg.get(key).amt += amount;
    }
  }

  function dictFrom(values) {
    const arr = Array.from(new Set(values)).sort();
    const map = new Map(arr.map((v, i) => [v, i]));
    return { arr, map };
  }

  const txRows = Array.from(txAgg.values());
  const tgtRows = Array.from(tgtAgg.values());

  const ymAll = dictFrom([...txRows.map(r => r.ym), ...tgtRows.map(r => r.ym)]);
  const trxAll = dictFrom([...txRows.map(r => r.trx), ...tgtRows.map(r => r.trx)]);
  const regAll = dictFrom([...txRows.map(r => r.region), ...tgtRows.map(r => r.region)]);
  const areaAll = dictFrom([...txRows.map(r => r.area), ...tgtRows.map(r => r.area)]);
  const kotaAll = dictFrom([...txRows.map(r => r.kota), ...tgtRows.map(r => r.kota)]);
  const brandAll = dictFrom([...tgtRows.map(r => r.brand), ...Array.from(prodMetaTmp.values()).map(v => v.brand)]);
  const katAll = dictFrom(Array.from(prodMetaTmp.values()).map(v => v.kat));
  const prodAll = dictFrom(txRows.map(r => r.produk));

  const prodBrandArr = new Array(prodAll.arr.length).fill(0);
  const prodKatArr = new Array(prodAll.arr.length).fill(0);
  prodMetaTmp.forEach((meta, prod) => {
    const idx = prodAll.map.get(prod);
    if (idx !== undefined) {
      prodBrandArr[idx] = brandAll.map.get(meta.brand) || 0;
      prodKatArr[idx] = katAll.map.get(meta.kat) || 0;
    }
  });

  const tx = {
    ym: txRows.map(r => ymAll.map.get(r.ym)),
    trx: txRows.map(r => trxAll.map.get(r.trx)),
    reg: txRows.map(r => regAll.map.get(r.region)),
    kota: txRows.map(r => kotaAll.map.get(r.kota)),
    area: txRows.map(r => areaAll.map.get(r.area)),
    prod: txRows.map(r => prodAll.map.get(r.produk)),
    qty: txRows.map(r => Math.round(r.qty)),
    amt: txRows.map(r => Math.round(r.amt)),
  };
  const tgt = {
    ym: tgtRows.map(r => ymAll.map.get(r.ym)),
    trx: tgtRows.map(r => trxAll.map.get(r.trx)),
    reg: tgtRows.map(r => regAll.map.get(r.region)),
    area: tgtRows.map(r => areaAll.map.get(r.area)),
    kota: tgtRows.map(r => kotaAll.map.get(r.kota)),
    brand: tgtRows.map(r => brandAll.map.get(r.brand)),
    amt: tgtRows.map(r => Math.round(r.amt)),
  };

  return {
    dicts: { ym: ymAll.arr, trx: trxAll.arr, reg: regAll.arr, area: areaAll.arr, kota: kotaAll.arr, brand: brandAll.arr, kat: katAll.arr, prod: prodAll.arr },
    prodMeta: { brand: prodBrandArr, kat: prodKatArr },
    tx, tgt,
    meta: { rowCount: rows.length, txCount: txRows.length, tgtCount: tgtRows.length },
  };
}

/* ============================================================
   SMALL UI PRIMITIVES
   ============================================================ */
function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700;800&display=swap');
      .cbs-root { font-family: 'Inter', -apple-system, sans-serif; color: #241934; background:#F7F5FA; }
      .cbs-display { font-family: 'Fraunces', Georgia, serif; }
      .cbs-card { background:#fff; border-radius:20px; border:1px solid #EDE7F5; box-shadow: 0 1px 2px rgba(36,25,52,0.04), 0 8px 24px -12px rgba(36,25,52,0.08); }
      .cbs-scroll::-webkit-scrollbar { height:8px; width:8px; }
      .cbs-scroll::-webkit-scrollbar-thumb { background:#E0D6EF; border-radius:8px; }
      .cbs-navitem { transition: all .15s ease; }
      .cbs-navitem:hover { background: rgba(255,255,255,0.08); }
      .cbs-navitem.active { background: linear-gradient(90deg, rgba(204,155,59,0.22), rgba(204,155,59,0.05)); border-left:3px solid #CC9B3B; }
      .cbs-chip { transition: all .12s ease; }
      .cbs-chip:hover { border-color:#CC9B3B; }
      .cbs-table th { position:sticky; top:0; background:#F7F5FA; z-index:1; }
      .cbs-fadein { animation: cbsFade .35s ease; }
      @keyframes cbsFade { from{opacity:0; transform:translateY(4px)} to{opacity:1; transform:translateY(0)} }
      input:focus, select:focus, button:focus-visible { outline: 2px solid #CC9B3B; outline-offset:1px; }
    `}</style>
  );
}

function MultiSelect({ label, options, value, onChange, width }) {
  const [open, setOpen] = useState(false);
  const allSelected = !value || value.length === 0;
  function toggle(opt) {
    if (allSelected) { onChange([opt]); return; }
    if (value.includes(opt)) {
      const next = value.filter(v => v !== opt);
      onChange(next);
    } else onChange([...value, opt]);
  }
  return (
    <div className="relative" style={{ width: width || 160 }}>
      <button onClick={() => setOpen(o => !o)}
        className="cbs-chip w-full flex items-center justify-between gap-1 px-3 py-2 rounded-xl border text-sm bg-white"
        style={{ borderColor: "#E4DCF2", color: "#241934" }}>
        <span className="truncate text-left">
          <span style={{ color: "#8A7FA0", marginRight: 4 }}>{label}:</span>
          {allSelected ? "Semua" : value.length === 1 ? value[0] : value.length + " dipilih"}
        </span>
        <ChevronDown size={14} color="#8A7FA0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 bg-white rounded-xl border cbs-scroll overflow-y-auto"
            style={{ borderColor: "#E4DCF2", maxHeight: 260, minWidth: "100%", boxShadow: "0 12px 32px -8px rgba(36,25,52,0.25)" }}>
            <button onClick={() => { onChange([]); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-[#F7F5FA]" style={{ color: "#CC9B3B", fontWeight: 600 }}>
              Semua {label}
            </button>
            {options.map(opt => (
              <label key={opt} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[#F7F5FA] cursor-pointer">
                <input type="checkbox" checked={!allSelected && value.includes(opt)} onChange={() => toggle(opt)} />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SingleSelect({ label, options, value, onChange, width }) {
  return (
    <div style={{ width: width || 130 }}>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="cbs-chip w-full px-3 py-2 rounded-xl border text-sm bg-white"
        style={{ borderColor: "#E4DCF2", color: "#241934" }}>
        {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </div>
  );
}

function KPICard({ icon: Icon, label, value, sub, accent, trend }) {
  return (
    <div className="cbs-card p-5 flex-1 min-w-[190px]">
      <div className="flex items-center justify-between mb-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: accent + "20" }}>
          <Icon size={17} color={accent} />
        </div>
        {trend !== undefined && trend !== null && (
          <span className="flex items-center gap-0.5 text-xs font-semibold" style={{ color: trend >= 0 ? "#2E7873" : "#C0596B" }}>
            {trend >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="text-xs mb-1" style={{ color: "#8A7FA0" }}>{label}</div>
      <div className="cbs-display text-2xl font-semibold" style={{ color: "#241934" }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: "#8A7FA0" }}>{sub}</div>}
    </div>
  );
}

function RoundTopBar(props) {
  const { fill, x, y, width, height, radius } = props;
  const r = Math.min(radius || 0, width / 2, Math.max(height, 0));
  if (height <= 0) return null;
  const path = `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
  return <path d={path} fill={fill} />;
}

function ProgressRing({ pct, size, color }) {
  const s = size || 88;
  const stroke = 9;
  const r = (s - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(pct, 100));
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      <circle cx={s/2} cy={s/2} r={r} fill="none" stroke="#EDE7F5" strokeWidth={stroke} />
      <circle cx={s/2} cy={s/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={c - (clamped / 100) * c}
        strokeLinecap="round" transform={`rotate(-90 ${s/2} ${s/2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="cbs-display"
        fontSize={s * 0.2} fontWeight="600" fill="#241934">{pct.toFixed(0)}%</text>
    </svg>
  );
}

/* ============================================================
   LOGIN SCREEN
   ============================================================ */
function LoginScreen({ onLogin }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  function submit(e) {
    e.preventDefault();
    const acc = USERS[u.trim().toLowerCase()];
    if (acc && acc.password === p) {
      setErr("");
      onLogin({ username: u.trim().toLowerCase(), role: acc.role, name: acc.name });
    } else setErr("Username atau password salah.");
  }
  return (
    <div className="cbs-root min-h-screen flex items-center justify-center p-6" style={{ background: "linear-gradient(135deg, #241934, #2E2049 55%, #241934)" }}>
      <GlobalStyle />
      <div className="w-full max-w-4xl grid md:grid-cols-2 rounded-3xl overflow-hidden" style={{ boxShadow: "0 30px 80px -20px rgba(0,0,0,0.5)" }}>
        <div className="hidden md:flex flex-col justify-between p-10" style={{ background: "linear-gradient(160deg,#2E2049,#1B1226)" }}>
          <div>
            <div className="flex items-center gap-2 mb-10">
              <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "#CC9B3B" }}>
                <Sparkles size={18} color="#1B1226" />
              </div>
              <span className="cbs-display text-white text-lg tracking-wide">Cahaya Bintang Sempurna</span>
            </div>
            <h1 className="cbs-display text-white text-4xl leading-tight mb-4">Sales<br/>Performance<br/>Dashboard</h1>
            <p className="text-sm" style={{ color: "#B8AECB" }}>Pantau capaian Selling In &amp; Selling Out seluruh distributor, toko, dan brand dalam satu tampilan.</p>
          </div>
          <div className="text-xs" style={{ color: "#7A6E93" }}>Bioaqua · Kojiesan · My BestFriend · Nature Dradiance</div>
        </div>
        <div className="bg-white p-10 flex flex-col justify-center">
          <h2 className="cbs-display text-2xl mb-1" style={{ color: "#241934" }}>Masuk</h2>
          <p className="text-sm mb-6" style={{ color: "#8A7FA0" }}>Gunakan akun demo di bawah untuk mencoba dashboard.</p>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-xs font-medium" style={{ color: "#6E6480" }}>Username</label>
              <div className="flex items-center gap-2 mt-1 px-3 py-2.5 rounded-xl border" style={{ borderColor: "#E4DCF2" }}>
                <User size={15} color="#8A7FA0" />
                <input value={u} onChange={e => setU(e.target.value)} placeholder="admin / view" className="w-full outline-none text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: "#6E6480" }}>Password</label>
              <div className="flex items-center gap-2 mt-1 px-3 py-2.5 rounded-xl border" style={{ borderColor: "#E4DCF2" }}>
                <Lock size={15} color="#8A7FA0" />
                <input type="password" value={p} onChange={e => setP(e.target.value)} placeholder="••••••••" className="w-full outline-none text-sm" />
              </div>
            </div>
            {err && <div className="text-xs" style={{ color: "#C0596B" }}>{err}</div>}
            <button type="submit" className="w-full py-2.5 rounded-xl text-sm font-semibold text-white mt-2"
              style={{ background: "#241934" }}>Masuk ke Dashboard</button>
          </form>
          <div className="mt-6 p-3 rounded-xl text-xs leading-relaxed" style={{ background: "#F7F5FA", color: "#6E6480" }}>
            <div className="font-semibold mb-1" style={{ color: "#241934" }}>Akun demo</div>
            Admin (unggah &amp; lihat data): <b>admin</b> / <b>admin123</b><br />
            Viewer (lihat saja): <b>view</b> / <b>view123</b>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SHELL: SIDEBAR + TOPBAR
   ============================================================ */
const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "kota", label: "Performance Kota", icon: MapPin },
  { id: "produk", label: "Performance Produk", icon: Package },
  { id: "target", label: "Achievement Target", icon: Target },
  { id: "insight", label: "Insight", icon: Sparkles },
];

function Sidebar({ page, setPage, user, onLogout, dataMeta }) {
  return (
    <div className="hidden md:flex flex-col shrink-0" style={{ width: 244, background: "#241934" }}>
      <div className="flex items-center gap-2 px-5 py-6">
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "#CC9B3B" }}>
          <Sparkles size={16} color="#1B1226" />
        </div>
        <div>
          <div className="cbs-display text-white text-sm leading-tight">Cahaya Bintang</div>
          <div className="text-[10px] tracking-widest uppercase" style={{ color: "#8A7FA0" }}>Sempurna</div>
        </div>
      </div>
      <div className="px-3 flex-1 py-2 space-y-1">
        {NAV_ITEMS.map(item => (
          <button key={item.id} onClick={() => setPage(item.id)}
            className={"cbs-navitem w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm " + (page === item.id ? "active" : "")}
            style={{ color: page === item.id ? "#fff" : "#B8AECB" }}>
            <item.icon size={16} />
            {item.label}
          </button>
        ))}
        {user.role === "admin" && (
          <button onClick={() => setPage("upload")}
            className={"cbs-navitem w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm " + (page === "upload" ? "active" : "")}
            style={{ color: page === "upload" ? "#fff" : "#B8AECB" }}>
            <UploadCloud size={16} />
            Upload Data
          </button>
        )}
      </div>
      <div className="px-4 pb-2 text-[11px]" style={{ color: "#7A6E93" }}>
        {dataMeta.txCount.toLocaleString("id-ID")} baris transaksi · {dataMeta.years.join("–")}
      </div>
      <div className="mx-3 mb-4 p-3 rounded-xl flex items-center gap-2" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold" style={{ background: "#CC9B3B", color: "#1B1226" }}>
          {user.name.slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-white truncate">{user.name}</div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: "#8A7FA0" }}>{user.role}</div>
        </div>
        <button onClick={onLogout} title="Keluar"><LogOut size={15} color="#B8AECB" /></button>
      </div>
    </div>
  );
}

function MobileNav({ page, setPage, user, onLogout }) {
  return (
    <div className="md:hidden flex items-center gap-2 overflow-x-auto cbs-scroll px-3 py-2" style={{ background: "#241934" }}>
      {NAV_ITEMS.concat(user.role === "admin" ? [{ id: "upload", label: "Upload", icon: UploadCloud }] : []).map(item => (
        <button key={item.id} onClick={() => setPage(item.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs shrink-0"
          style={{ background: page === item.id ? "#CC9B3B" : "rgba(255,255,255,0.08)", color: page === item.id ? "#1B1226" : "#B8AECB" }}>
          <item.icon size={13} />{item.label}
        </button>
      ))}
      <button onClick={onLogout} className="ml-auto shrink-0 text-xs px-2" style={{ color: "#B8AECB" }}><LogOut size={14} /></button>
    </div>
  );
}

/* ============================================================
   PAGE: DASHBOARD
   ============================================================ */
function DashboardPage({ M }) {
  const [year, setYear] = useState(M.years[M.years.length - 2] || M.years[0]);
  const [regions, setRegions] = useState([]);
  const [areas, setAreas] = useState([]);
  const [kotas, setKotas] = useState([]);
  const [brands, setBrands] = useState([]);

  const si = useMemo(() => computeDashboardSeries(M, { year, trx: "Selling In", regions, areas, kotas, brands }), [M, year, regions, areas, kotas, brands]);
  const so = useMemo(() => computeDashboardSeries(M, { year, trx: "Selling Out", regions, areas, kotas, brands }), [M, year, regions, areas, kotas, brands]);

  return (
    <div className="cbs-fadein space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <SingleSelect label="Tahun" value={year} onChange={setYear} width={110}
          options={M.years.map(y => ({ value: y, label: y }))} />
        <MultiSelect label="Region" options={M.regions} value={regions} onChange={setRegions} width={150} />
        <MultiSelect label="Area" options={M.areas} value={areas} onChange={setAreas} width={150} />
        <MultiSelect label="Kota" options={M.kotas} value={kotas} onChange={setKotas} width={170} />
        <MultiSelect label="Brand" options={M.brands} value={brands} onChange={setBrands} width={170} />
      </div>

      <div className="flex flex-wrap gap-4">
        <KPICard icon={ArrowUpRight} label={`Total Selling In ${year}`} value={formatIDR(si.total, true)} sub={`Rata-rata/bulan aktif: ${formatIDR(si.avg, true)}`} accent="#6B5CA5" />
        <KPICard icon={ArrowDownRight} label={`Total Selling Out ${year}`} value={formatIDR(so.total, true)} sub={`Rata-rata/bulan aktif: ${formatIDR(so.avg, true)}`} accent="#CC9B3B" />
        <KPICard icon={TrendingUp} label="Bulan Aktif SI" value={si.activeMonths + " / 12"} sub="Bulan dengan transaksi" accent="#2E7873" />
        <KPICard icon={TrendingUp} label="Bulan Aktif SO" value={so.activeMonths + " / 12"} sub="Bulan dengan transaksi" accent="#C0596B" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <ChartCard title="Selling In per Brand" subtitle={`Pencapaian nasional ${year}, Jan–Des`} data={si.chartData} brands={si.activeBrands} />
        <ChartCard title="Selling Out per Brand" subtitle={`Pencapaian nasional ${year}, Jan–Des`} data={so.chartData} brands={so.activeBrands} />
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, data, brands }) {
  return (
    <div className="cbs-card p-5">
      <div className="mb-1 cbs-display text-lg" style={{ color: "#241934" }}>{title}</div>
      <div className="text-xs mb-4" style={{ color: "#8A7FA0" }}>{subtitle}</div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#EDE7F5" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#8A7FA0" }} axisLine={{ stroke: "#EDE7F5" }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#8A7FA0" }} axisLine={false} tickLine={false} tickFormatter={v => formatIDR(v, true)} width={64} />
          <Tooltip formatter={(v, name) => [formatIDR(v), name]} contentStyle={{ borderRadius: 12, border: "1px solid #EDE7F5", fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {brands.map((b, idx) => (
            <Bar key={b} dataKey={b} stackId="s" fill={BRAND_COLORS[b] || "#999"}
              shape={idx === brands.length - 1 ? (p => <RoundTopBar {...p} radius={8} />) : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ============================================================
   PAGE: PERFORMANCE KOTA
   ============================================================ */
function KotaPage({ M }) {
  const [year, setYear] = useState(M.years[M.years.length - 2] || M.years[0]);
  const [trx, setTrx] = useState("Selling Out");
  const [brands, setBrands] = useState([]);
  const rows = useMemo(() => computeKotaPerformance(M, { year, trx, brands }), [M, year, trx, brands]);
  const grandTotal = rows.reduce((a, r) => a + r.total, 0);

  let lastRegion = null;
  return (
    <div className="cbs-fadein space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SingleSelect label="Tahun" value={year} onChange={setYear} width={110} options={M.years.map(y => ({ value: y, label: y }))} />
        <SingleSelect label="Kategori Trx" value={trx} onChange={setTrx} width={160}
          options={[{ value: "Selling Out", label: "Selling Out" }, { value: "Selling In", label: "Selling In" }]} />
        <MultiSelect label="Brand" options={M.brands} value={brands} onChange={setBrands} width={170} />
        <div className="ml-auto text-sm" style={{ color: "#6E6480" }}>
          Total {trx} {year}: <b className="cbs-display">{formatIDR(grandTotal, true)}</b>
        </div>
      </div>
      <div className="cbs-card overflow-hidden">
        <div className="overflow-x-auto cbs-scroll">
          <table className="w-full text-sm cbs-table" style={{ minWidth: 1100 }}>
            <thead>
              <tr style={{ color: "#8A7FA0" }}>
                <th className="text-left px-4 py-3 font-medium">Region</th>
                <th className="text-left px-2 py-3 font-medium">Kota</th>
                {MONTHS.map(m => <th key={m} className="text-right px-2 py-3 font-medium">{m}</th>)}
                <th className="text-right px-3 py-3 font-medium" style={{ color: "#241934" }}>Total</th>
                <th className="text-right px-4 py-3 font-medium" style={{ color: "#241934" }}>Avg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const showRegion = r.region !== lastRegion;
                lastRegion = r.region;
                return (
                  <tr key={r.region + r.kota} style={{ borderTop: "1px solid #F1ECFA", background: i % 2 ? "#FCFBFE" : "#fff" }}>
                    <td className="px-4 py-2 whitespace-nowrap" style={{ color: showRegion ? "#241934" : "transparent", fontWeight: 600 }}>{r.region}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.kota}</td>
                    {r.months.map((v, mi) => <td key={mi} className="text-right px-2 py-2 tabular-nums" style={{ color: v ? "#241934" : "#D8D0E8" }}>{v ? formatIDR(v, true) : "–"}</td>)}
                    <td className="text-right px-3 py-2 font-semibold tabular-nums">{formatIDR(r.total, true)}</td>
                    <td className="text-right px-4 py-2 tabular-nums" style={{ color: "#8A7FA0" }}>{formatIDR(r.avg, true)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={16} className="text-center py-10" style={{ color: "#8A7FA0" }}>Tidak ada data untuk filter ini.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: PERFORMANCE PRODUK
   ============================================================ */
function ProdukPage({ M }) {
  const [year, setYear] = useState(M.years[M.years.length - 2] || M.years[0]);
  const [trx, setTrx] = useState("Selling Out");
  const [chanels, setChanels] = useState([]);
  const [regions, setRegions] = useState([]);
  const [kotas, setKotas] = useState([]);
  const [areas, setAreas] = useState([]);
  const [kategoris, setKategoris] = useState([]);
  const [brands, setBrands] = useState([]);
  const [metric, setMetric] = useState("amt");

  const rows = useMemo(() => computeProdukPerformance(M, { year, trx, chanels, regions, kotas, areas, kategoris, brands }),
    [M, year, trx, chanels, regions, kotas, areas, kategoris, brands]);
  const grandTotal = rows.reduce((a, r) => a + (metric === "amt" ? r.totalAmt : r.totalQty), 0);
  let lastBrand = null;

  return (
    <div className="cbs-fadein space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SingleSelect label="Tahun" value={year} onChange={setYear} width={100} options={M.years.map(y => ({ value: y, label: y }))} />
        <SingleSelect label="Kategori Trx" value={trx} onChange={setTrx} width={150}
          options={[{ value: "Selling Out", label: "Selling Out" }, { value: "Selling In", label: "Selling In" }]} />
        <MultiSelect label="Chanel" options={["Offline", "Online"]} value={chanels} onChange={setChanels} width={130} />
        <MultiSelect label="Region" options={M.regions} value={regions} onChange={setRegions} width={140} />
        <MultiSelect label="Kota" options={M.kotas} value={kotas} onChange={setKotas} width={150} />
        <MultiSelect label="Area" options={M.areas} value={areas} onChange={setAreas} width={140} />
        <MultiSelect label="Kategori" options={M.kategoris} value={kategoris} onChange={setKategoris} width={150} />
        <MultiSelect label="Brand" options={M.brands} value={brands} onChange={setBrands} width={160} />
        <SingleSelect label="Metrik" value={metric} onChange={setMetric} width={110}
          options={[{ value: "amt", label: "Value" }, { value: "qty", label: "Qty" }]} />
      </div>
      <div className="text-sm" style={{ color: "#6E6480" }}>
        Total {metric === "amt" ? "Value" : "Qty"} {trx} {year}: <b className="cbs-display">{metric === "amt" ? formatIDR(grandTotal, true) : formatNum(grandTotal)}</b> · {rows.length} produk
      </div>
      <div className="cbs-card overflow-hidden">
        <div className="overflow-x-auto cbs-scroll">
          <table className="w-full text-sm cbs-table" style={{ minWidth: 1200 }}>
            <thead>
              <tr style={{ color: "#8A7FA0" }}>
                <th className="text-left px-4 py-3 font-medium">Brand</th>
                <th className="text-left px-2 py-3 font-medium">Produk</th>
                {MONTHS.map(m => <th key={m} className="text-right px-2 py-3 font-medium">{m}</th>)}
                <th className="text-right px-3 py-3 font-medium" style={{ color: "#241934" }}>Total</th>
                <th className="text-right px-4 py-3 font-medium" style={{ color: "#241934" }}>Avg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const showBrand = r.brand !== lastBrand;
                lastBrand = r.brand;
                const monthArr = metric === "amt" ? r.amtM : r.qtyM;
                const total = metric === "amt" ? r.totalAmt : r.totalQty;
                const avg = metric === "amt" ? r.avgAmt : r.avgQty;
                const fmt = metric === "amt" ? (v => formatIDR(v, true)) : formatNum;
                return (
                  <tr key={r.brand + r.produk} style={{ borderTop: "1px solid #F1ECFA", background: i % 2 ? "#FCFBFE" : "#fff" }}>
                    <td className="px-4 py-2 whitespace-nowrap" style={{ color: showBrand ? BRAND_COLORS[r.brand] : "transparent", fontWeight: 700 }}>{r.brand}</td>
                    <td className="px-2 py-2" style={{ minWidth: 240 }}>{r.produk}</td>
                    {monthArr.map((v, mi) => <td key={mi} className="text-right px-2 py-2 tabular-nums" style={{ color: v ? "#241934" : "#D8D0E8" }}>{v ? fmt(v) : "–"}</td>)}
                    <td className="text-right px-3 py-2 font-semibold tabular-nums">{fmt(total)}</td>
                    <td className="text-right px-4 py-2 tabular-nums" style={{ color: "#8A7FA0" }}>{fmt(avg)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={16} className="text-center py-10" style={{ color: "#8A7FA0" }}>Tidak ada data untuk filter ini.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: ACHIEVEMENT TARGET
   ============================================================ */
function TargetPage({ M }) {
  const [year, setYear] = useState(M.years[M.years.length - 2] || M.years[0]);
  const [month, setMonth] = useState("ALL");
  const [regions, setRegions] = useState([]);
  const [areas, setAreas] = useState([]);
  const [kotas, setKotas] = useState([]);

  const res = useMemo(() => computeAchievement(M, {
    year, month: month === "ALL" ? "ALL" : parseInt(month, 10), regions, areas, kotas
  }), [M, year, month, regions, areas, kotas]);

  return (
    <div className="cbs-fadein space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <SingleSelect label="Tahun" value={year} onChange={setYear} width={100} options={M.years.map(y => ({ value: y, label: y }))} />
        <SingleSelect label="Bulan" value={month} onChange={setMonth} width={120}
          options={[{ value: "ALL", label: "Semua Bulan" }, ...MONTHS.map((m, i) => ({ value: String(i), label: m }))]} />
        <MultiSelect label="Region" options={M.regions} value={regions} onChange={setRegions} width={150} />
        <MultiSelect label="Area" options={M.areas} value={areas} onChange={setAreas} width={150} />
        <MultiSelect label="Kota" options={M.kotas} value={kotas} onChange={setKotas} width={170} />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <AchCard title="Selling In vs Target SI" data={res.si} color="#6B5CA5" />
        <AchCard title="Selling Out vs Target SO" data={res.so} color="#CC9B3B" />
      </div>

      <div>
        <div className="cbs-display text-lg mb-3" style={{ color: "#241934" }}>Breakdown per Brand</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {res.brandBreakdown.map(b => (
            <div key={b.brand} className="cbs-card p-4">
              <div className="text-sm font-semibold mb-3" style={{ color: BRAND_COLORS[b.brand] }}>{b.brand}</div>
              <BrandMiniRow label="SI" pack={b.si} />
              <BrandMiniRow label="SO" pack={b.so} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BrandMiniRow({ label, pack }) {
  const color = pack.pct >= 100 ? "#2E7873" : pack.pct >= 80 ? "#CC9B3B" : "#C0596B";
  return (
    <div className="flex items-center justify-between py-1.5 border-t" style={{ borderColor: "#F1ECFA" }}>
      <div>
        <div className="text-[10px] uppercase tracking-wide" style={{ color: "#8A7FA0" }}>{label}</div>
        <div className="text-xs font-medium tabular-nums">{formatIDR(pack.actual, true)}</div>
      </div>
      <div className="text-sm font-bold tabular-nums" style={{ color }}>{formatPct(pack.pct)}</div>
    </div>
  );
}

function AchCard({ title, data, color }) {
  const gapPositive = data.gap >= 0;
  return (
    <div className="cbs-card p-6">
      <div className="cbs-display text-lg mb-4" style={{ color: "#241934" }}>{title}</div>
      <div className="flex items-center gap-6 flex-wrap">
        <ProgressRing pct={data.pct} size={104} color={data.pct >= 100 ? "#2E7873" : color} />
        <div className="flex-1 min-w-[180px] space-y-2">
          <Row label="Pencapaian" value={formatIDR(data.actual, true)} bold />
          <Row label="Target" value={formatIDR(data.target, true)} />
          <Row label="Gap vs Target" value={(gapPositive ? "+" : "") + formatIDR(data.gap, true)} color={gapPositive ? "#2E7873" : "#C0596B"} />
        </div>
      </div>
    </div>
  );
}
function Row({ label, value, bold, color }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: "#8A7FA0" }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, color: color || "#241934" }} className="tabular-nums">{value}</span>
    </div>
  );
}

/* ============================================================
   PAGE: INSIGHT (extra)
   ============================================================ */
function InsightPage({ M }) {
  const [year, setYear] = useState(M.years[M.years.length - 2] || M.years[0]);
  const [trx, setTrx] = useState("Selling Out");
  const ins = useMemo(() => computeInsights(M, { year, trx }), [M, year, trx]);

  const pieData = [
    { name: "Offline", value: ins.chanelMix.Offline },
    { name: "Online", value: ins.chanelMix.Online },
  ];
  const pieColors = ["#6B5CA5", "#CC9B3B"];

  return (
    <div className="cbs-fadein space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <SingleSelect label="Tahun" value={year} onChange={setYear} width={110} options={M.years.map(y => ({ value: y, label: y }))} />
        <SingleSelect label="Kategori Trx" value={trx} onChange={setTrx} width={160}
          options={[{ value: "Selling Out", label: "Selling Out" }, { value: "Selling In", label: "Selling In" }]} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="cbs-card p-5 lg:col-span-1">
          <div className="cbs-display text-base mb-3">Top 5 Kota — {trx}</div>
          {ins.topKota.map((k, i) => (
            <BarRow key={k.name} rank={i + 1} label={k.name} value={k.value} max={ins.topKota[0] ? ins.topKota[0].value : 1} color="#6B5CA5" fmt={v => formatIDR(v, true)} />
          ))}
        </div>
        <div className="cbs-card p-5 lg:col-span-1">
          <div className="cbs-display text-base mb-3">Top 5 Produk — {trx}</div>
          {ins.topProduk.map((k, i) => (
            <BarRow key={k.name} rank={i + 1} label={k.name} value={k.value} max={ins.topProduk[0] ? ins.topProduk[0].value : 1} color="#CC9B3B" fmt={v => formatIDR(v, true)} />
          ))}
        </div>
        <div className="cbs-card p-5 lg:col-span-1">
          <div className="cbs-display text-base mb-3">Kontribusi Chanel — {trx}</div>
          <ResponsiveContainer width="100%" height={190}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                {pieData.map((e, i) => <Cell key={e.name} fill={pieColors[i]} />)}
              </Pie>
              <Tooltip formatter={v => formatIDR(v)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 text-xs mt-1">
            {pieData.map((e, i) => <span key={e.name} className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: pieColors[i] }} />{e.name}</span>)}
          </div>
        </div>
      </div>

      <div className="cbs-card p-5">
        <div className="cbs-display text-base mb-1">Tren Bulanan — Perbandingan Tahun</div>
        <div className="text-xs mb-4" style={{ color: "#8A7FA0" }}>{trx} nasional, seluruh brand</div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={ins.yoyChart} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#EDE7F5" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#8A7FA0" }} axisLine={{ stroke: "#EDE7F5" }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#8A7FA0" }} axisLine={false} tickLine={false} tickFormatter={v => formatIDR(v, true)} width={64} />
            <Tooltip formatter={v => formatIDR(v)} contentStyle={{ borderRadius: 12, border: "1px solid #EDE7F5", fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {M.years.map((y, i) => (
              <Line key={y} type="monotone" dataKey={y} stroke={i % 2 ? "#CC9B3B" : "#6B5CA5"} strokeWidth={2.5} dot={{ r: 3 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
function BarRow({ rank, label, value, max, color, fmt }) {
  const pct = max ? (value / max) * 100 : 0;
  return (
    <div className="mb-2.5">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="truncate" style={{ color: "#241934", maxWidth: 200 }}>{rank}. {label}</span>
        <span className="font-semibold tabular-nums shrink-0 ml-2" style={{ color }}>{fmt(value)}</span>
      </div>
      <div className="h-1.5 rounded-full" style={{ background: "#F1ECFA" }}>
        <div className="h-1.5 rounded-full" style={{ width: pct + "%", background: color }} />
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: UPLOAD (admin only)
   ============================================================ */
function UploadPage({ onDataLoaded, dataMeta }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  function handleFile(file) {
    if (!file) return;
    setBusy(true); setStatus(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
        const sheetName = wb.SheetNames.includes("Data") ? "Data" : wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
        if (!rows.length) throw new Error("File tidak berisi baris data.");
        const newRaw = buildRawFromRows(rows);
        if (newRaw.tx.ym.length === 0 && newRaw.tgt.ym.length === 0) throw new Error("Tidak ditemukan baris dengan Kategori Trx yang valid.");
        onDataLoaded(newRaw);
        setStatus({ type: "ok", msg: `Berhasil memuat ${newRaw.meta.rowCount.toLocaleString("id-ID")} baris (${newRaw.meta.txCount.toLocaleString("id-ID")} transaksi, ${newRaw.meta.tgtCount.toLocaleString("id-ID")} target).` });
      } catch (err) {
        setStatus({ type: "err", msg: "Gagal memproses file: " + err.message });
      } finally { setBusy(false); }
    };
    reader.onerror = () => { setStatus({ type: "err", msg: "Gagal membaca file." }); setBusy(false); };
    reader.readAsArrayBuffer(file);
  }

  return (
    <div className="cbs-fadein max-w-2xl space-y-5">
      <div className="cbs-card p-6">
        <div className="cbs-display text-lg mb-1">Upload Database Terbaru</div>
        <p className="text-sm mb-5" style={{ color: "#8A7FA0" }}>
          Unggah file Excel (.xlsx) dengan struktur kolom yang sama seperti database Sales Performance:
          Bulan, Kategori Trx, Chanel, Region, Kota, Area, Id Produk, Nama Produk, Kategori, Brand, Id Toko, Nama Toko, Qty, Amount.
        </p>
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current && fileRef.current.click()}
          className="rounded-2xl border-2 border-dashed flex flex-col items-center justify-center py-12 cursor-pointer"
          style={{ borderColor: "#D9CDEE", background: "#FBFAFD" }}>
          <UploadCloud size={28} color="#CC9B3B" />
          <div className="text-sm mt-3" style={{ color: "#241934" }}>Klik atau seret file .xlsx ke sini</div>
          <div className="text-xs mt-1" style={{ color: "#8A7FA0" }}>Data akan diproses langsung di browser Anda</div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => handleFile(e.target.files[0])} />
        </div>
        {busy && <div className="text-sm mt-4" style={{ color: "#8A7FA0" }}>Memproses file…</div>}
        {status && (
          <div className="flex items-start gap-2 mt-4 p-3 rounded-xl text-sm"
            style={{ background: status.type === "ok" ? "#EAF5F3" : "#FAEBEE", color: status.type === "ok" ? "#2E7873" : "#C0596B" }}>
            {status.type === "ok" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
            <span>{status.msg}</span>
          </div>
        )}
      </div>
      <div className="cbs-card p-6">
        <div className="cbs-display text-base mb-2">Data Saat Ini</div>
        <div className="text-sm space-y-1" style={{ color: "#6E6480" }}>
          <div>Periode: <b style={{ color: "#241934" }}>{dataMeta.years.join(" – ")}</b></div>
          <div>Baris transaksi (SI+SO): <b style={{ color: "#241934" }}>{dataMeta.txCount.toLocaleString("id-ID")}</b></div>
          <div>Baris target: <b style={{ color: "#241934" }}>{dataMeta.tgtCount.toLocaleString("id-ID")}</b></div>
          <div>Kota terdaftar: <b style={{ color: "#241934" }}>{dataMeta.kotaCount}</b></div>
          <div>Produk terdaftar: <b style={{ color: "#241934" }}>{dataMeta.prodCount}</b></div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ROOT APP
   ============================================================ */
export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [raw, setRaw] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then((json) => setRaw(json))
      .catch((err) => setLoadError(err.message));
  }, []);

  const M = useMemo(() => (raw ? buildModel(raw) : null), [raw]);
  const dataMeta = useMemo(() => {
    if (!raw || !M) return null;
    return {
      years: M.years, txCount: raw.tx.ym.length, tgtCount: raw.tgt.ym.length,
      kotaCount: M.kotas.length, prodCount: raw.dicts.prod.length,
    };
  }, [M, raw]);

  const handleDataLoaded = useCallback((newRaw) => { setRaw(newRaw); setPage("dashboard"); }, []);

  if (loadError) {
    return (
      <div className="cbs-root min-h-screen flex items-center justify-center p-6">
        <GlobalStyle />
        <div className="cbs-card p-6 max-w-md text-center">
          <div className="cbs-display text-lg mb-2">Gagal memuat data</div>
          <p className="text-sm" style={{ color: "#8A7FA0" }}>{loadError}. Pastikan file public/data/dashboard-data.json tersedia.</p>
        </div>
      </div>
    );
  }

  if (!raw || !M || !dataMeta) {
    return (
      <div className="cbs-root min-h-screen flex items-center justify-center p-6" style={{ background: "#241934" }}>
        <GlobalStyle />
        <div className="text-white text-sm">Memuat data penjualan…</div>
      </div>
    );
  }

  if (!user) return <LoginScreen onLogin={setUser} />;

  return (
    <div className="cbs-root min-h-screen flex">
      <GlobalStyle />
      <Sidebar page={page} setPage={setPage} user={user} onLogout={() => setUser(null)} dataMeta={dataMeta} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav page={page} setPage={setPage} user={user} onLogout={() => setUser(null)} />
        <div className="px-4 md:px-8 py-3 flex items-center justify-between border-b" style={{ borderColor: "#EDE7F5", background: "#fff" }}>
          <div>
            <div className="cbs-display text-lg" style={{ color: "#241934" }}>
              {(NAV_ITEMS.find(n => n.id === page) || {}).label || (page === "upload" ? "Upload Data" : "")}
            </div>
            <div className="text-xs" style={{ color: "#8A7FA0" }}>PT. Cahaya Bintang Sempurna · Sales Performance</div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full" style={{ background: "#F7F5FA", color: "#6E6480" }}>
            <Building2 size={13} /> {user.role === "admin" ? "Admin" : "Viewer"}
          </div>
        </div>
        <div className="flex-1 p-4 md:p-8 overflow-y-auto cbs-scroll">
          {page === "dashboard" && <DashboardPage M={M} />}
          {page === "kota" && <KotaPage M={M} />}
          {page === "produk" && <ProdukPage M={M} />}
          {page === "target" && <TargetPage M={M} />}
          {page === "insight" && <InsightPage M={M} />}
          {page === "upload" && user.role === "admin" && <UploadPage onDataLoaded={handleDataLoaded} dataMeta={dataMeta} />}
        </div>
      </div>
    </div>
  );
}
