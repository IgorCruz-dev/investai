/* =========================================================================
   InvestAI Terminal — render dos dados reais exportados em data.js
   Gráficos em SVG escrito à mão: nenhuma biblioteca externa.
   ========================================================================= */
(function () {
  "use strict";

  const DATA = window.INVESTAI_DATA || {};
  const SVG_NS = "http://www.w3.org/2000/svg";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Formatação (pt-BR) ---------------- */
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: DATA.currency || "BRL" });
  const brlCompact = new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: DATA.currency || "BRL", notation: "compact", maximumFractionDigits: 1,
  });
  const num = (v, d = 2) =>
    v === null || v === undefined || Number.isNaN(v)
      ? "N/D"
      : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const money = (v) => (v === null || v === undefined || Number.isNaN(v) ? "N/D" : brl.format(v));
  const pct = (v, d = 2) => {
    if (v === null || v === undefined || Number.isNaN(v)) return "N/D";
    const sign = v > 0 ? "+" : "";
    return sign + num(v, d) + "%";
  };
  const signClass = (v) =>
    v === null || v === undefined || Number.isNaN(v) ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat";
  const dateBR = (iso) => {
    if (!iso) return "—";
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  };
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------------- Helpers de SVG ---------------- */
  function el(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key in attrs || {}) node.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(node);
    return node;
  }

  /** Largura útil do container, para desenhar em pixels reais. */
  function hostWidth(host, fallback = 1000) {
    const width = host && host.clientWidth ? Math.round(host.clientWidth) : 0;
    return Math.max(420, width || fallback);
  }

  function svgRoot(width, height) {
    // Sem escala: `preserveAspectRatio="none"` esticaria o SVG inteiro, e junto
    // com ele o texto dos eixos — num gráfico financeiro isso salta aos olhos.
    const svg = el("svg", {
      class: "chart",
      viewBox: `0 0 ${width} ${height}`,
      width: width,
      height: height,
      role: "img",
    });
    svg.style.height = height + "px";
    return svg;
  }

  /** Caminho suavizado (Catmull-Rom → Bézier): linha fluida sem overshoot. */
  function smoothPath(points) {
    if (!points.length) return "";
    if (points.length < 3) return points.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
    let d = `M${points[0][0]} ${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  function animateDraw(node) {
    if (reduceMotion || !node.getTotalLength) return;
    const len = node.getTotalLength();
    node.style.setProperty("--len", len);
    node.classList.add("draw-in");
  }

  /** Números que contam ao carregar. */
  function countUp(node, target, format) {
    if (reduceMotion || !Number.isFinite(target)) {
      node.textContent = format(target);
      return;
    }
    const duration = 1100;
    const start = performance.now();
    (function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = format(target * eased);
      if (t < 1) requestAnimationFrame(frame);
    })(start);
  }

  /* ---------------- Tooltip ---------------- */
  const tooltip = document.getElementById("tooltip");
  function showTooltip(x, y, html) {
    tooltip.innerHTML = html;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
    tooltip.classList.add("on");
  }
  const hideTooltip = () => tooltip.classList.remove("on");

  /* =========================================================================
     Aba 1 — Carteira
     ========================================================================= */
  const ICONS = {
    wallet: '<path d="M3 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M16 11h3v4h-3a2 2 0 010-4z"/>',
    trend: '<path d="M3 17l5-6 4 3 5-8"/><path d="M17 6h4v4"/>',
    star: '<path d="M12 4l2.3 5.2 5.7.6-4.3 3.8 1.2 5.6L12 16.4 7.1 19.2l1.2-5.6L4 9.8l5.7-.6z"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  };

  function kpiCard({ label, icon, value, foot, delta, deltaClass, format }) {
    const card = document.createElement("article");
    card.className = "card kpi lift";
    card.innerHTML = `
      <div class="kpi-head">
        <span class="kpi-label">${esc(label)}</span>
        <span class="kpi-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
               stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
        </span>
      </div>
      <div class="kpi-value"></div>
      <div class="kpi-foot">
        ${delta !== undefined ? `<span class="delta ${deltaClass}">${esc(delta)}</span>` : ""}
        <span>${esc(foot || "")}</span>
      </div>`;
    const valueNode = card.querySelector(".kpi-value");
    if (format) countUp(valueNode, value, format);
    else valueNode.textContent = value;
    return card;
  }

  function renderKpis() {
    const host = document.getElementById("kpis");
    if (!host) return;
    const totals = DATA.totals || {};
    const positions = (DATA.positions || []).slice();
    const ranked = positions.filter((p) => Number.isFinite(p.pnlPct)).sort((a, b) => b.pnlPct - a.pnlPct);
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];

    host.append(
      kpiCard({
        label: "Valor da carteira", icon: ICONS.wallet, value: totals.total_value,
        format: money, foot: `custo ${money(totals.total_cost)}`,
      }),
      kpiCard({
        label: "Resultado total", icon: ICONS.trend, value: totals.pnl_abs, format: money,
        delta: pct(totals.pnl_pct), deltaClass: signClass(totals.pnl_pct), foot: "desde a compra",
      }),
      kpiCard({
        label: "Melhor ativo", icon: ICONS.star, value: best ? best.ticker.replace(".SA", "") : "—",
        delta: best ? pct(best.pnlPct) : "", deltaClass: best ? signClass(best.pnlPct) : "flat",
        foot: best ? best.name : "",
      }),
      kpiCard({
        label: "Pior ativo", icon: ICONS.warn, value: worst ? worst.ticker.replace(".SA", "") : "—",
        delta: worst ? pct(worst.pnlPct) : "", deltaClass: worst ? signClass(worst.pnlPct) : "flat",
        foot: worst ? worst.name : "",
      })
    );
  }

  function renderPositions() {
    const body = document.getElementById("positions-body");
    if (!body) return;
    const rows = (DATA.positions || []).slice().sort((a, b) => (b.weight || 0) - (a.weight || 0));

    body.innerHTML = rows
      .map((p, i) => {
        const code = p.ticker.replace(".SA", "");
        return `<tr>
          <td>
            <div class="asset-cell">
              <span class="asset-badge" aria-hidden="true">${esc(code.slice(0, 4))}</span>
              <span class="asset-name"><strong>${esc(code)}</strong><small>${esc(p.name)}</small></span>
            </div>
          </td>
          <td>${num(p.shares, 0)}</td>
          <td>${money(p.avgPrice)}</td>
          <td>${money(p.price)}</td>
          <td>${money(p.value)}</td>
          <td class="${signClass(p.pnl)}">${money(p.pnl)}</td>
          <td class="${signClass(p.pnlPct)}">${pct(p.pnlPct)}</td>
          <td class="${signClass(p.change7d)}">${pct(p.change7d)}</td>
          <td>
            <div class="weight-cell">
              <span>${num(p.weight, 1)}%</span>
              <span class="weight-bar"><span class="weight-fill"
                style="width:${Math.max(0, Math.min(100, p.weight || 0))}%;animation-delay:${i * 90}ms"></span></span>
            </div>
          </td>
        </tr>`;
      })
      .join("");
  }

  /* ---------------- Gráfico de área: evolução ---------------- */
  let currentRange = 0;
  let currentTechRange = 120;

  function renderEvolution(rangeDays) {
    const host = document.getElementById("evolution-chart");
    if (!host) return;
    const all = DATA.evolution || [];
    const series = rangeDays > 0 ? all.slice(-rangeDays) : all;
    host.innerHTML = "";
    if (series.length < 2) {
      host.innerHTML = '<p class="section-note">Sem histórico suficiente.</p>';
      return;
    }

    const W = hostWidth(host), H = 300;
    const pad = { top: 18, right: 62, bottom: 26, left: 8 };
    const values = series.map((d) => d.value);
    const cost = series[0].cost;
    const lo = Math.min(...values, cost);
    const hi = Math.max(...values, cost);
    const span = hi - lo || 1;
    const min = lo - span * 0.12;
    const max = hi + span * 0.12;

    const x = (i) => pad.left + (i / (series.length - 1)) * (W - pad.left - pad.right);
    const y = (v) => pad.top + (1 - (v - min) / (max - min)) * (H - pad.top - pad.bottom);

    const svg = svgRoot(W, H);
    svg.setAttribute("aria-label",
      `Evolução do patrimônio de ${dateBR(series[0].date)} a ${dateBR(series[series.length - 1].date)}`);

    const defs = el("defs", {}, svg);
    const grad = el("linearGradient", { id: "areaGold", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    el("stop", { offset: "0%", "stop-color": "#d4af37", "stop-opacity": "0.42" }, grad);
    el("stop", { offset: "55%", "stop-color": "#d4af37", "stop-opacity": "0.12" }, grad);
    el("stop", { offset: "100%", "stop-color": "#d4af37", "stop-opacity": "0" }, grad);

    // Grade horizontal + eixo de valores
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const v = min + ((max - min) * t) / ticks;
      const gy = y(v);
      el("line", { class: "grid-line", x1: pad.left, y1: gy, x2: W - pad.right, y2: gy }, svg);
      const label = el("text", {
        class: "axis-text", x: W - pad.right + 9, y: gy + 3.5, "text-anchor": "start",
      }, svg);
      label.textContent = brlCompact.format(v);
    }

    const points = series.map((d, i) => [x(i), y(d.value)]);
    const line = smoothPath(points);

    el("path", {
      d: `${line} L${x(series.length - 1)} ${H - pad.bottom} L${x(0)} ${H - pad.bottom} Z`,
      fill: "url(#areaGold)", class: "fade-in",
    }, svg);

    const costY = y(cost);
    el("line", { class: "cost-line", x1: pad.left, y1: costY, x2: W - pad.right, y2: costY }, svg);

    const stroke = el("path", { d: line, class: "area-line" }, svg);
    animateDraw(stroke);

    const lastX = x(series.length - 1);
    const lastY = y(values[values.length - 1]);
    el("circle", { class: "endpoint-halo fade-in", cx: lastX, cy: lastY, r: 9 }, svg);
    el("circle", { class: "endpoint-dot fade-in", cx: lastX, cy: lastY, r: 4 }, svg);

    // Datas no eixo X
    [0, Math.floor(series.length / 2), series.length - 1].forEach((i, k) => {
      const label = el("text", {
        class: "axis-text", x: x(i), y: H - 6,
        "text-anchor": k === 0 ? "start" : k === 2 ? "end" : "middle",
      }, svg);
      label.textContent = dateBR(series[i].date).slice(0, 5);
    });

    // Crosshair interativo
    const cross = el("line", { class: "crosshair", y1: pad.top, y2: H - pad.bottom, opacity: "0" }, svg);
    const marker = el("circle", { class: "endpoint-dot", r: 4, opacity: "0" }, svg);
    const hit = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }, svg);

    function move(event) {
      const box = svg.getBoundingClientRect();
      const ratio = (event.clientX - box.left) / box.width;
      const i = Math.max(0, Math.min(series.length - 1, Math.round(ratio * (series.length - 1))));
      const point = series[i];
      const px = x(i), py = y(point.value);
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("opacity", "1");
      marker.setAttribute("cx", px); marker.setAttribute("cy", py); marker.setAttribute("opacity", "1");
      const pnl = point.value - point.cost;
      const pnlPct = point.cost ? (pnl / point.cost) * 100 : null;
      showTooltip(
        box.left + (px / W) * box.width,
        box.top + (py / H) * box.height,
        `<div class="tooltip-date">${dateBR(point.date)}</div>
         <div class="tooltip-row"><span>Valor</span><b>${money(point.value)}</b></div>
         <div class="tooltip-row"><span>Resultado</span><b class="${signClass(pnl)}">${pct(pnlPct)}</b></div>`
      );
    }

    hit.addEventListener("mousemove", move);
    hit.addEventListener("mouseleave", () => {
      cross.setAttribute("opacity", "0");
      marker.setAttribute("opacity", "0");
      hideTooltip();
    });

    host.appendChild(svg);

    const first = series[0], last = series[series.length - 1];
    const variation = ((last.value / first.value - 1) * 100);
    const note = document.getElementById("evolution-note");
    if (note) {
      note.innerHTML = `${dateBR(first.date)} → ${dateBR(last.date)} · <span class="${signClass(variation)}">${pct(variation)}</span> no período`;
    }
  }

  /* =========================================================================
     Aba 2 — Análise técnica
     ========================================================================= */
  function sliceAsset(asset, days) {
    const n = asset.dates.length;
    const from = days > 0 ? Math.max(0, n - days) : 0;
    const cut = (arr) => (arr || []).slice(from);
    return {
      dates: cut(asset.dates), open: cut(asset.open), high: cut(asset.high),
      low: cut(asset.low), close: cut(asset.close),
      ma20: cut(asset.ma20), ma50: cut(asset.ma50), ma200: cut(asset.ma200), rsi: cut(asset.rsi),
    };
  }

  function candleChart(slice, width) {
    const W = Math.max(420, width || 1000), HP = 260, HR = 96, GAP = 16;
    const H = HP + GAP + HR;
    const pad = { left: 8, right: 64, top: 14, bottom: 20 };
    const n = slice.close.length;

    const lows = slice.low.filter(Number.isFinite);
    const highs = slice.high.filter(Number.isFinite);
    const mas = [].concat(slice.ma20, slice.ma50, slice.ma200).filter(Number.isFinite);
    const lo = Math.min(...lows, ...mas);
    const hi = Math.max(...highs, ...mas);
    const span = hi - lo || 1;
    const min = lo - span * 0.06;
    const max = hi + span * 0.06;

    const x = (i) => pad.left + (i / Math.max(1, n - 1)) * (W - pad.left - pad.right);
    const yP = (v) => pad.top + (1 - (v - min) / (max - min)) * (HP - pad.top - pad.bottom);
    const yR = (v) => HP + GAP + (1 - v / 100) * (HR - 14);

    const svg = svgRoot(W, H);
    svg.setAttribute("aria-label", "Candlestick com médias móveis e RSI");

    // --- grade e eixo de preço
    for (let t = 0; t <= 4; t++) {
      const v = min + ((max - min) * t) / 4;
      const gy = yP(v);
      el("line", { class: "grid-line", x1: pad.left, y1: gy, x2: W - pad.right, y2: gy }, svg);
      const label = el("text", { class: "axis-text", x: W - pad.right + 9, y: gy + 3.5 }, svg);
      label.textContent = num(v, 2);
    }

    // --- candles
    const bodyW = Math.max(1.2, Math.min(7, (W - pad.left - pad.right) / n * 0.62));
    for (let i = 0; i < n; i++) {
      const o = slice.open[i], c = slice.close[i], h = slice.high[i], l = slice.low[i];
      if (![o, c, h, l].every(Number.isFinite)) continue;
      const rising = c >= o;
      const cx = x(i);
      el("line", {
        class: rising ? "wick-up" : "wick-down",
        x1: cx, y1: yP(h), x2: cx, y2: yP(l),
      }, svg);
      const top = yP(Math.max(o, c));
      const height = Math.max(1, Math.abs(yP(o) - yP(c)));
      el("rect", {
        class: rising ? "candle-up" : "candle-down",
        x: cx - bodyW / 2, y: top, width: bodyW, height,
        opacity: rising ? 0.9 : 0.85, rx: 0.8,
      }, svg);
    }

    // --- médias móveis
    [["ma200", slice.ma200], ["ma50", slice.ma50], ["ma20", slice.ma20]].forEach(([cls, values]) => {
      const points = [];
      values.forEach((v, i) => { if (Number.isFinite(v)) points.push([x(i), yP(v)]); });
      if (points.length > 1) {
        const path = el("path", { d: smoothPath(points), class: cls }, svg);
        animateDraw(path);
      }
    });

    // --- RSI: zonas, referências e linha
    el("rect", { class: "rsi-zone-over", x: pad.left, y: yR(100), width: W - pad.left - pad.right, height: yR(70) - yR(100) }, svg);
    el("rect", { class: "rsi-zone-under", x: pad.left, y: yR(30), width: W - pad.left - pad.right, height: yR(0) - yR(30) }, svg);
    [30, 50, 70].forEach((level) => {
      el("line", { class: "rsi-ref", x1: pad.left, y1: yR(level), x2: W - pad.right, y2: yR(level) }, svg);
      const label = el("text", { class: "axis-text", x: W - pad.right + 9, y: yR(level) + 3.5 }, svg);
      label.textContent = String(level);
    });

    const rsiPoints = [];
    slice.rsi.forEach((v, i) => { if (Number.isFinite(v)) rsiPoints.push([x(i), yR(v)]); });
    if (rsiPoints.length > 1) {
      const path = el("path", { d: smoothPath(rsiPoints), class: "rsi-line" }, svg);
      animateDraw(path);
    }
    const rsiLabel = el("text", { class: "axis-text", x: pad.left + 2, y: HP + GAP + 11 }, svg);
    rsiLabel.textContent = "RSI 14";

    // --- datas
    [0, Math.floor(n / 2), n - 1].forEach((i, k) => {
      if (!slice.dates[i]) return;
      const label = el("text", {
        class: "axis-text", x: x(i), y: HP - 2,
        "text-anchor": k === 0 ? "start" : k === 2 ? "end" : "middle",
      }, svg);
      label.textContent = dateBR(slice.dates[i]).slice(0, 5);
    });

    // --- crosshair com OHLC
    const cross = el("line", { class: "crosshair", y1: pad.top, y2: HP - pad.bottom, opacity: "0" }, svg);
    const hit = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }, svg);
    hit.addEventListener("mousemove", (event) => {
      const box = svg.getBoundingClientRect();
      const ratio = (event.clientX - box.left) / box.width;
      const i = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
      const px = x(i);
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("opacity", "1");
      const change = slice.open[i] ? ((slice.close[i] / slice.open[i] - 1) * 100) : null;
      showTooltip(
        box.left + (px / W) * box.width,
        box.top + (yP(slice.close[i]) / H) * box.height,
        `<div class="tooltip-date">${dateBR(slice.dates[i])}</div>
         <div class="tooltip-row"><span>Abertura</span><b>${num(slice.open[i])}</b></div>
         <div class="tooltip-row"><span>Máx / Mín</span><b>${num(slice.high[i])} / ${num(slice.low[i])}</b></div>
         <div class="tooltip-row"><span>Fechamento</span><b class="${signClass(change)}">${num(slice.close[i])}</b></div>
         <div class="tooltip-row"><span>RSI</span><b>${num(slice.rsi[i], 1)}</b></div>`
      );
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("opacity", "0"); hideTooltip(); });

    return svg;
  }

  const TREND = {
    ALTA: ["badge-up", "Alta"],
    BAIXA: ["badge-down", "Baixa"],
    NEUTRO: ["badge-flat", "Neutro"],
  };

  function renderTechnical(days) {
    const host = document.getElementById("technical-cards");
    if (!host) return;
    host.innerHTML = "";

    Object.values(DATA.assets || {}).forEach((asset) => {
      const ind = asset.indicators || {};
      const fund = asset.fundamentals || {};
      const [badgeClass, badgeLabel] = TREND[ind.trend_signal] || TREND.NEUTRO;
      const code = asset.ticker.replace(".SA", "");

      const card = document.createElement("article");
      card.className = "card asset-card lift";
      card.innerHTML = `
        <div class="asset-head">
          <div class="asset-title">
            <span class="asset-badge" aria-hidden="true">${esc(code.slice(0, 4))}</span>
            <div>
              <h3>${esc(code)} <small>${esc(asset.name)} · ${esc(asset.sector)}</small></h3>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span class="badge ${badgeClass}">${badgeLabel}</span>
            <span class="delta ${signClass(ind.price_change_7d)}">${pct(ind.price_change_7d)} 7d</span>
            <span class="kpi-value" style="font-size:20px">${money(ind.price_current)}</span>
          </div>
        </div>
        <dl class="metric-strip">
          <div class="metric"><dt>RSI 14</dt><dd class="${ind.rsi_14 > 70 ? "down" : ind.rsi_14 < 30 ? "up" : ""}">${num(ind.rsi_14, 1)}</dd></div>
          <div class="metric"><dt>MM20</dt><dd>${num(ind.ma_20)}</dd></div>
          <div class="metric"><dt>MM50</dt><dd>${num(ind.ma_50)}</dd></div>
          <div class="metric"><dt>MM200</dt><dd>${num(ind.ma_200)}</dd></div>
          <div class="metric"><dt>Vol. anual</dt><dd>${num(ind.volatility_30d, 1)}%</dd></div>
          <div class="metric"><dt>P/L</dt><dd>${num(fund.pe_ratio, 1)}</dd></div>
          <div class="metric"><dt>Div. yield</dt><dd>${num(fund.dividend_yield, 2)}%</dd></div>
          <div class="metric"><dt>12 meses</dt><dd class="${signClass(ind.price_change_1y)}">${pct(ind.price_change_1y, 1)}</dd></div>
        </dl>`;

      // O card já está no DOM na hora de medir? Não — então usa a largura do
      // host menos o padding horizontal do card (24px de cada lado).
      const available = hostWidth(host) - 48;
      card.appendChild(candleChart(sliceAsset(asset, days), available));

      const legend = document.createElement("div");
      legend.className = "legend";
      legend.innerHTML = `
        <span><i style="background:#5b9dff"></i> MM20</span>
        <span><i style="background:#d4af37"></i> MM50</span>
        <span><i style="background:#b07cff"></i> MM200</span>
        <span><i style="background:#4dd4f7"></i> RSI 14</span>
        <span><i style="background:rgba(255,71,87,.5)"></i> sobrecompra &gt; 70</span>
        <span><i style="background:rgba(0,200,150,.5)"></i> sobrevenda &lt; 30</span>`;
      card.appendChild(legend);
      host.appendChild(card);
    });
  }

  /* =========================================================================
     Aba 3 — Briefing (markdown mínimo → HTML)
     ========================================================================= */
  function markdown(src) {
    const lines = String(src || "").split("\n");
    const out = [];
    let inList = false, inTable = false;

    const inline = (text) =>
      esc(text)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[\s(])\*(?!\s)([^*]+?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
        .replace(/_(.+?)_/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>");

    const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
    const closeTable = () => { if (inTable) { out.push("</tbody></table>"); inTable = false; } };

    for (let raw of lines) {
      const line = raw.replace(/\s+$/, "");

      if (!line.trim()) { closeList(); closeTable(); continue; }

      if (/^#{1,4}\s/.test(line)) {
        closeList(); closeTable();
        const level = line.match(/^#+/)[0].length;
        out.push(`<h${Math.min(level, 3)}>${inline(line.replace(/^#+\s*/, ""))}</h${Math.min(level, 3)}>`);
        continue;
      }
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { closeList(); closeTable(); out.push("<hr>"); continue; }
      if (/^>\s?/.test(line)) {
        closeList(); closeTable();
        out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
        continue;
      }
      if (/^\|/.test(line)) {
        const cells = line.split("|").slice(1, -1).map((c) => c.trim());
        if (/^[\s|:-]+$/.test(line)) continue;              // separador
        if (!inTable) {
          closeList();
          out.push("<table><thead><tr>" + cells.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
          inTable = true;
        } else {
          out.push("<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
        }
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        closeTable();
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
        continue;
      }
      closeList(); closeTable();
      out.push(`<p>${inline(line)}</p>`);
    }
    closeList(); closeTable();
    return out.join("\n");
  }

  function renderBriefing() {
    const button = document.getElementById("generate-btn");
    const label = document.getElementById("generate-label");
    const gate = document.getElementById("briefing-gate");
    const body = document.getElementById("briefing-body");
    const meta = document.getElementById("briefing-meta");
    if (!button) return;

    button.addEventListener("click", () => {
      if (!DATA.briefing) {
        label.textContent = "Briefing indisponível neste snapshot";
        button.disabled = true;
        return;
      }
      button.disabled = true;
      label.textContent = "Analisando carteira, indicadores e notícias…";

      // No app ao vivo é aqui que a chamada ao Claude entra; neste snapshot o
      // briefing já foi gerado, e o atraso existe só para a transição não piscar.
      setTimeout(() => {
        gate.hidden = true;
        body.innerHTML = markdown(DATA.briefing);
        body.hidden = false;
        meta.innerHTML = `
          <span>Gerado em <b style="color:var(--gold)">${dateBR(DATA.generatedAt)}</b></span>
          <span>modelo <b style="color:var(--gold)">claude-opus-5</b></span>
          <span>${(DATA.briefing.length / 1000).toFixed(1)} mil caracteres</span>`;
        meta.hidden = false;
        body.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }, reduceMotion ? 0 : 900);
    });
  }

  /* =========================================================================
     Aba 4 — Notícias
     ========================================================================= */
  function renderNews() {
    const grid = document.getElementById("news-grid");
    const filter = document.getElementById("news-filter");
    if (!grid) return;

    const groups = DATA.news || {};
    const tickers = Object.keys(groups).filter((t) => (groups[t] || []).length);
    const items = [];
    tickers.forEach((ticker) => (groups[ticker] || []).forEach((a) => items.push({ ...a, ticker })));
    items.sort((a, b) => String(b.published).localeCompare(String(a.published)));

    if (filter) {
      filter.innerHTML = [`<button class="filter-btn" data-ticker="" aria-pressed="true">Todos (${items.length})</button>`]
        .concat(tickers.map((t) =>
          `<button class="filter-btn" data-ticker="${esc(t)}" aria-pressed="false">${esc(t.replace(".SA", ""))} (${groups[t].length})</button>`))
        .join("");
    }

    function paint(ticker) {
      const list = ticker ? items.filter((i) => i.ticker === ticker) : items;
      grid.innerHTML = list.length
        ? list.map((a) => {
            const outlet = a.source || "Fonte não informada";
            return `<a class="card news-card lift" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">
              <div class="news-top">
                <span class="outlet">
                  <span class="outlet-mark" aria-hidden="true">${esc(outlet.slice(0, 1))}</span>
                  <span>
                    <span class="outlet-name">${esc(outlet)}</span><br>
                    <span class="outlet-date">${dateBR(a.published)}</span>
                  </span>
                </span>
                <span class="tag">${esc(a.ticker.replace(".SA", ""))}</span>
              </div>
              <h3 class="news-title">${esc(a.title)}</h3>
              ${a.description ? `<p class="section-note">${esc(a.description.slice(0, 180))}…</p>` : ""}
              <span class="news-foot">Abrir no veículo
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>
              </span>
            </a>`;
          }).join("")
        : '<p class="section-note">Nenhuma notícia relevante para este ativo na semana.</p>';
    }

    paint("");
    if (filter) {
      filter.addEventListener("click", (event) => {
        const button = event.target.closest(".filter-btn");
        if (!button) return;
        filter.querySelectorAll(".filter-btn").forEach((b) =>
          b.setAttribute("aria-pressed", String(b === button)));
        paint(button.dataset.ticker);
      });
    }
  }

  /* =========================================================================
     Navegação e inicialização
     ========================================================================= */
  function setupTabs() {
    const buttons = Array.from(document.querySelectorAll(".nav-btn"));
    const views = Array.from(document.querySelectorAll(".view"));

    const exists = (name) => Boolean(name && document.getElementById("view-" + name));

    function activate(name, pushHash) {
      buttons.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === name)));
      views.forEach((v) => v.classList.toggle("active", v.id === "view-" + name));

      // Um container oculto mede 0 de largura, e o gráfico sairia no tamanho de
      // fallback, centralizado e com sobra nas laterais. Redesenha ao exibir.
      if (name === "overview") renderEvolution(currentRange);
      if (name === "technical") renderTechnical(currentTechRange);

      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      // O hash deixa cada aba linkável (e sobrevive a um recarregamento).
      if (pushHash && location.hash.slice(1) !== name) {
        history.replaceState(null, "", "#" + name);
      }
      try { localStorage.setItem("investai.tab", name); } catch (e) { /* storage bloqueado */ }
    }

    buttons.forEach((button) =>
      button.addEventListener("click", () => activate(button.dataset.view, true)));

    window.addEventListener("hashchange", () => {
      const name = location.hash.slice(1);
      if (exists(name)) activate(name, false);
    });

    // Precedência: hash da URL > última aba usada > padrão.
    let initial = "overview";
    try {
      const saved = localStorage.getItem("investai.tab");
      if (exists(saved)) initial = saved;
    } catch (e) { /* storage bloqueado: segue no padrão */ }
    const fromHash = location.hash.slice(1);
    if (exists(fromHash)) initial = fromHash;
    activate(initial, false);
  }

  function setupRanges() {
    document.querySelectorAll(".range-btn:not(.tech-range)").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".range-btn:not(.tech-range)").forEach((b) =>
          b.setAttribute("aria-pressed", String(b === button)));
        currentRange = Number(button.dataset.range);
        renderEvolution(currentRange);
      });
    });

    document.querySelectorAll(".tech-range").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".tech-range").forEach((b) =>
          b.setAttribute("aria-pressed", String(b === button)));
        currentTechRange = Number(button.dataset.range);
        renderTechnical(currentTechRange);
      });
    });
  }

  function init() {
    const evolution = DATA.evolution || [];
    const lastDate = evolution.length ? evolution[evolution.length - 1].date : DATA.generatedAt;
    const stamp = document.getElementById("stamp-date");
    if (stamp) stamp.textContent = dateBR(lastDate);
    const foot = document.getElementById("foot-stamp");
    if (foot) foot.textContent = dateBR(lastDate).slice(0, 5);

    renderKpis();
    renderPositions();
    renderEvolution(0);
    renderTechnical(currentTechRange);
    renderBriefing();
    renderNews();
    setupTabs();
    setupRanges();

    let resizeTimer = null;
    let lastWidth = window.innerWidth;
    window.addEventListener("resize", () => {
      // Só redesenha quando a largura muda de fato: no mobile, rolar a página
      // dispara resize por causa da barra de endereço.
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        renderEvolution(currentRange);
        renderTechnical(currentTechRange);
      }, 180);
    }, { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
