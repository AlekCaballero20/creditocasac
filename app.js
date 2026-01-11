// app.js (mejorado)
// - KPIs y progreso para el index mejorado
// - Animaciones suaves (sin marear)
// - Tabla + filtros igual
// - Estimación de fin de pago igual, pero con UX más clara

import { CONFIG } from "./config.js";

const $ = (id) => document.getElementById(id);

const el = {
  // base
  btnReload: $("btnReload"),
  totalCredito: $("totalCredito"),
  totalAbonado: $("totalAbonado"),
  saldoRestante: $("saldoRestante"),
  ultimoPago: $("ultimoPago"),
  ultimoPagoValor: $("ultimoPagoValor"),

  // nuevos (hero + progreso)
  heroBadge: $("heroBadge"),
  progressPercent: $("progressPercent"),
  progressFill: $("progressFill"),
  progressPaid: $("progressPaid"),
  progressLeft: $("progressLeft"),

  // KPIs extra
  kpiMonthsWithPayments: $("kpiMonthsWithPayments"),
  kpiAvgMonthlyAll: $("kpiAvgMonthlyAll"),
  kpiAvgMonthly6: $("kpiAvgMonthly6"),
  kpiMonthlyGoal: $("kpiMonthlyGoal"),

  // proyección
  projectionMode: $("projectionMode"),
  manualWrap: $("manualWrap"),
  manualMonthly: $("manualMonthly"),
  monthlyUsed: $("monthlyUsed"),
  monthsLeft: $("monthsLeft"),
  payoffDate: $("payoffDate"),
  projectionPill: $("projectionPill"),

  // mini progreso proyección
  miniPercent: $("miniPercent"),
  miniFill: $("miniFill"),
  miniNote: $("miniNote"),

  // histórico
  search: $("search"),
  yearFilter: $("yearFilter"),
  tableBody: $("table")?.querySelector("tbody"),
  status: $("status"),
  lastUpdatedValue: $("lastUpdatedValue"),
};

let rawRows = [];
let computedRows = [];
let monthTotals = []; // [{key:"2024-11", total: 1500000, date: Date}]
let summary = null;

init();

function init() {
  // defaults
  if (el.projectionMode) el.projectionMode.value = CONFIG.DEFAULT_PROJECTION_MODE;
  if (el.manualMonthly) el.manualMonthly.value = CONFIG.DEFAULT_MANUAL_MONTHLY_PAYMENT;

  // listeners
  el.btnReload?.addEventListener("click", load);
  el.projectionMode?.addEventListener("change", () => {
    renderProjection();
    renderKpis();
  });
  el.manualMonthly?.addEventListener("input", () => {
    renderProjection();
    renderKpis();
  });

  el.search?.addEventListener("input", applyFilters);
  el.yearFilter?.addEventListener("change", applyFilters);

  load();
}

async function load() {
  setStatus("📥 Cargando datos…");
  try {
    const tsv = await fetchText(CONFIG.TSV_URL);
    rawRows = parseTSV(tsv);

    if (rawRows.length === 0) throw new Error("No se encontraron filas en el TSV.");

    computedRows = buildComputedRows(rawRows, CONFIG.TOTAL_CREDITO);
    monthTotals = buildMonthlyTotals(computedRows);
    summary = buildSummary(computedRows, CONFIG.TOTAL_CREDITO);

    renderSummary();
    renderProgress();
    renderKpis();
    buildYearFilter(computedRows);
    applyFilters();
    renderProjection();

    setLastUpdatedNow();
    setStatus(`✅ Listo. Registros: ${computedRows.length}. Meses con pago: ${monthTotals.length}.`);
  } catch (err) {
    console.error(err);
    setStatus("❌ Error: " + (err?.message || err));
    safeSetText(el.heroBadge, "⚠️ No se pudo cargar");
  }
}

/* -----------------------------
   Fetch
------------------------------ */
async function fetchText(url) {
  // importante: no cachear datos
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`No pude leer el TSV (${res.status}).`);
  return await res.text();
}

/* -----------------------------
   Parse TSV
------------------------------ */
function parseTSV(tsvText) {
  const lines = tsvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const idxFecha = headers.indexOf("fecha");
  const idxMes = headers.indexOf("mes");
  const idxValor = headers.indexOf("valor");

  if (idxFecha === -1 || idxMes === -1 || idxValor === -1) {
    throw new Error("El TSV debe tener columnas: Fecha, Mes, Valor.");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const fechaStr = (cols[idxFecha] || "").trim();
    const mesStr = (cols[idxMes] || "").trim();
    const valorStr = (cols[idxValor] || "").trim();

    if (!fechaStr && !mesStr && !valorStr) continue;

    const fecha = parseColDate(fechaStr);
    const valor = parseCOP(valorStr);

    rows.push({
      fechaStr,
      mesStr,
      valorStr,
      fecha,
      valor,
    });
  }

  // ordenar por fecha cuando exista
  rows.sort((a, b) => {
    if (a.fecha && b.fecha) return a.fecha - b.fecha;
    if (a.fecha && !b.fecha) return -1;
    if (!a.fecha && b.fecha) return 1;
    return (a.fechaStr || "").localeCompare(b.fechaStr || "");
  });

  return rows;
}

function parseColDate(s) {
  // 01/01/2022, 06/03/24, 28/04/24
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;

  let dd = Number(m[1]);
  let mm = Number(m[2]) - 1;
  let yy = Number(m[3]);
  if (yy < 100) yy = 2000 + yy;

  const d = new Date(yy, mm, dd);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseCOP(s) {
  // "$1.274.000" -> 1274000
  const cleaned = (s || "")
    .replace(/\s/g, "")
    .replace(/\$/g, "")
    .replace(/\./g, "")
    .replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/* -----------------------------
   Compute
------------------------------ */
function buildComputedRows(rows, totalCredito) {
  let acumulado = 0;
  return rows.map((r) => {
    acumulado += r.valor;
    const saldo = totalCredito - acumulado;
    return { ...r, acumulado, saldo };
  });
}

function buildMonthlyTotals(rows) {
  // agrupa por YYYY-MM usando fecha real
  const map = new Map();
  for (const r of rows) {
    if (!r.fecha) continue;
    const key = `${r.fecha.getFullYear()}-${String(r.fecha.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, (map.get(key) || 0) + (r.valor || 0));
  }
  const arr = [...map.entries()].map(([key, total]) => {
    const [y, m] = key.split("-").map(Number);
    return { key, total, date: new Date(y, m - 1, 1) };
  });
  arr.sort((a, b) => a.date - b.date);
  return arr;
}

function buildSummary(rows, totalCredito) {
  const totalAbonado = rows.reduce((acc, r) => acc + (r.valor || 0), 0);
  const saldo = totalCredito - totalAbonado;
  const last = [...rows].reverse().find((r) => r.fecha && r.valor > 0) || null;
  return { totalCredito, totalAbonado, saldo, last };
}

/* -----------------------------
   Render: Summary
------------------------------ */
function renderSummary() {
  safeSetText(el.totalCredito, money(summary.totalCredito));
  safeSetText(el.totalAbonado, money(summary.totalAbonado));
  safeSetText(el.saldoRestante, money(summary.saldo));

  if (summary.last) {
    safeSetText(el.ultimoPago, fmtDate(summary.last.fecha));
    safeSetText(el.ultimoPagoValor, `Valor: ${money(summary.last.valor)} 💵`);
  } else {
    safeSetText(el.ultimoPago, "—");
    safeSetText(el.ultimoPagoValor, "");
  }

  // badge de estado
  if (summary.saldo <= 0) {
    safeSetText(el.heroBadge, "🎉 ¡Pagado!");
  } else {
    safeSetText(el.heroBadge, "⏳ En curso");
  }
}

/* -----------------------------
   Render: Progreso (porcentaje bonito)
------------------------------ */
function renderProgress() {
  const total = summary.totalCredito || 0;
  const paid = summary.totalAbonado || 0;
  const left = Math.max(0, summary.saldo || 0);

  const pct = total > 0 ? clamp((paid / total) * 100, 0, 100) : 0;

  safeSetText(el.progressPercent, `${formatPct(pct)}%`);
  safeSetText(el.progressPaid, money(paid));
  safeSetText(el.progressLeft, money(left));

  // animación suave de la barra
  animateWidth(el.progressFill, pct);

  // mini progreso también
  safeSetText(el.miniPercent, `${formatPct(pct)}%`);
  animateWidth(el.miniFill, pct);

  // aria
  const pb = document.querySelector(".progressBar");
  if (pb) pb.setAttribute("aria-valuenow", String(Math.round(pct)));
}

/* -----------------------------
   Render: KPIs extra
------------------------------ */
function renderKpis() {
  // meses con pago
  safeSetText(el.kpiMonthsWithPayments, monthTotals.length ? String(monthTotals.length) : "—");

  // promedio mensual total
  const avgAll = monthTotals.length
    ? Math.round(monthTotals.reduce((a, m) => a + m.total, 0) / monthTotals.length)
    : 0;
  safeSetText(el.kpiAvgMonthlyAll, avgAll ? money(avgAll) : "—");

  // promedio últimos 6
  const last6 = monthTotals.slice(-6);
  const avg6 = last6.length
    ? Math.round(last6.reduce((a, m) => a + m.total, 0) / last6.length)
    : 0;
  safeSetText(el.kpiAvgMonthly6, avg6 ? money(avg6) : "—");

  // meta manual (si existe)
  const manual = Number(el.manualMonthly?.value || 0);
  safeSetText(el.kpiMonthlyGoal, manual > 0 ? money(manual) : "—");
}

/* -----------------------------
   Year filter + search
------------------------------ */
function buildYearFilter(rows) {
  if (!el.yearFilter) return;

  const years = new Set();
  for (const r of rows) {
    if (r.fecha) years.add(r.fecha.getFullYear());
  }
  const arr = [...years].sort((a, b) => b - a);

  el.yearFilter.innerHTML =
    `<option value="">Todos los años</option>` +
    arr.map((y) => `<option value="${y}">${y}</option>`).join("");
}

function applyFilters() {
  if (!el.tableBody) return;

  const q = (el.search?.value || "").toLowerCase().trim();
  const year = el.yearFilter?.value || "";

  const filtered = computedRows.filter((r) => {
    if (year && r.fecha && String(r.fecha.getFullYear()) !== String(year)) return false;
    if (year && !r.fecha) return false;

    if (!q) return true;

    const f = r.fecha ? fmtDate(r.fecha).toLowerCase() : (r.fechaStr || "").toLowerCase();
    const m = (r.mesStr || "").toLowerCase();
    const v = money(r.valor).toLowerCase();
    const a = money(r.acumulado).toLowerCase();
    return [f, m, v, a].some((x) => x.includes(q));
  });

  renderTable(filtered);
}

function renderTable(rows) {
  if (!el.tableBody) return;

  el.tableBody.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${r.fecha ? fmtDate(r.fecha) : esc(r.fechaStr)}</td>
        <td>${esc(r.mesStr)}</td>
        <td class="right">${money(r.valor)}</td>
        <td class="right">${money(r.acumulado)}</td>
        <td class="right">${money(r.saldo)}</td>
      </tr>
    `
    )
    .join("");
}

/* -----------------------------
   Render: Proyección (con mensajes más humanos)
------------------------------ */
function renderProjection() {
  const mode = el.projectionMode?.value || CONFIG.DEFAULT_PROJECTION_MODE;
  const saldo = summary?.saldo ?? 0;

  // mostrar/ocultar manual
  if (el.manualWrap) el.manualWrap.style.display = mode === "manual" ? "flex" : "none";

  // definir mensual usado
  let monthly = 0;

  if (mode === "manual") {
    monthly = Number(el.manualMonthly?.value || 0);
  } else if (mode === "last_month") {
    const lastMonth = monthTotals[monthTotals.length - 1];
    monthly = lastMonth ? lastMonth.total : 0;
  } else if (mode === "all_month_avg") {
    monthly = monthTotals.length
      ? Math.round(monthTotals.reduce((a, m) => a + m.total, 0) / monthTotals.length)
      : 0;
  } else {
    const last6 = monthTotals.slice(-6);
    monthly = last6.length ? Math.round(last6.reduce((a, m) => a + m.total, 0) / last6.length) : 0;
  }

  safeSetText(el.monthlyUsed, money(monthly));

  // pill
  safeSetText(el.projectionPill, modeLabel(mode));

  if (saldo <= 0) {
    safeSetText(el.monthsLeft, "0");
    safeSetText(el.payoffDate, "🎉 Ya quedó pagado (según estos datos)");
    safeSetText(el.miniNote, "Listo. A celebrar con un tintico ☕🙂");
    return;
  }

  if (monthly <= 0 || !summary?.last?.fecha) {
    safeSetText(el.monthsLeft, "—");
    safeSetText(el.payoffDate, "—");
    safeSetText(
      el.miniNote,
      "No hay suficiente info para estimar. Si quieren, pongan una cuota mensual manual ✍️"
    );
    return;
  }

  const monthsLeft = Math.ceil(saldo / monthly);
  safeSetText(el.monthsLeft, String(monthsLeft));

  // payoff: desde el último mes con pago
  const lastMonthDate = monthTotals.length ? monthTotals[monthTotals.length - 1].date : summary.last.fecha;
  const payoff = addMonths(lastMonthDate, monthsLeft);

  safeSetText(el.payoffDate, `🏁 ${fmtMonthYear(payoff)}`);

  // nota amable
  if (monthsLeft <= 6) {
    safeSetText(el.miniNote, "Ya falta poquito. Constancia y listo ✅");
  } else if (monthsLeft <= 18) {
    safeSetText(el.miniNote, "Va bien. Mantener el ritmo ayuda mucho 💪");
  } else {
    safeSetText(el.miniNote, "Es un camino largo, pero va avanzando paso a paso 🧡");
  }

  // refresca progreso (por si cambiaron manual)
  renderProgress();
}

/* -----------------------------
   Utils: dates / formatting
------------------------------ */
function addMonths(date, months) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setMonth(d.getMonth() + months);
  return d;
}

function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function fmtMonthYear(d) {
  const meses = [
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
  ];
  return `${meses[d.getMonth()]} ${d.getFullYear()}`;
}

function money(n) {
  const v = Math.max(0, Math.round(Number(n || 0)));
  return v.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}

function setStatus(msg) {
  safeSetText(el.status, msg);
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeSetText(node, text) {
  if (!node) return;
  node.textContent = text;
}

function setLastUpdatedNow() {
  if (!el.lastUpdatedValue) return;
  const now = new Date();
  const pretty = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  el.lastUpdatedValue.textContent = pretty;
}

/* -----------------------------
   UX helpers
------------------------------ */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatPct(pct) {
  // 1 decimal si es < 10% para que se sienta progreso, si no entero
  if (pct < 10) return pct.toFixed(1);
  return String(Math.round(pct));
}

function modeLabel(mode) {
  if (mode === "manual") return "✍️ Manual";
  if (mode === "last_month") return "🧾 Último mes";
  if (mode === "all_month_avg") return "📊 Promedio total";
  return "📌 Promedio 6 meses";
}

function animateWidth(node, targetPct) {
  if (!node) return;

  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const to = clamp(targetPct, 0, 100);

  if (prefersReduced) {
    node.style.width = `${to}%`;
    return;
  }

  // animación suave con requestAnimationFrame
  const from = Number((node.style.width || "0%").replace("%", "")) || 0;
  const duration = 650; // ms (suave)
  const start = performance.now();

  function step(t) {
    const p = clamp((t - start) / duration, 0, 1);
    // easing (easeOutCubic)
    const eased = 1 - Math.pow(1 - p, 3);
    const val = from + (to - from) * eased;
    node.style.width = `${val}%`;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
