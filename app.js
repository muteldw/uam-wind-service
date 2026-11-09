// V5 vertiport wind viewer. Loads one model case (base.bin) and applies a
// DEMO time evolution (scale + veer). The demo evolution is synthetic.
(async function () {
  const meta = await (await fetch("data/meta.json")).json();
  const buf = await (await fetch("data/base.bin")).arrayBuffer();
  const raw = new Int16Array(buf);
  const [NV, NZ, NY, NX] = meta.shape;
  const SC = meta.scale;
  const IDX = (v, z, y, x) => ((v * NZ + z) * NY + y) * NX + x;
  const VX = meta.x_index_vertiport, VY = meta.y_index_vertiport;
  const zs = meta.z;

  const $ = (id) => document.getElementById(id);
  const hourEl = $("hour"), levelEl = $("level"), startEl = $("startTime");

  // default start: now (KST, rounded to hour)
  const now = new Date(Date.now() + 9 * 3600e3);
  now.setUTCMinutes(0, 0, 0);
  startEl.value = now.toISOString().slice(0, 16);

  zs.forEach((z, k) => {
    const o = document.createElement("option");
    o.value = k; o.textContent = `${z} m`;
    levelEl.appendChild(o);
  });
  levelEl.value = 0;

  // DEMO: scale and veer over 24 h cycle (synthetic)
  function demoFactors(h) {
    const ph = (2 * Math.PI * h) / 24;
    return { s: 1 + 0.2 * Math.sin(ph + Math.PI / 3), dDeg: 10 * Math.sin(ph) };
  }

  // wind (u,v) at index for hour h
  function uv(h, z, y, x) {
    const { s, dDeg } = demoFactors(h);
    const d = (dDeg * Math.PI) / 180;
    const u0 = raw[IDX(0, z, y, x)] * SC, v0 = raw[IDX(1, z, y, x)] * SC;
    return [s * (u0 * Math.cos(d) - v0 * Math.sin(d)), s * (u0 * Math.sin(d) + v0 * Math.cos(d))];
  }

  // max speed over approach layer near vertiport, for warning
  function approachMax(h) {
    let m = 0;
    for (let z = 0; z <= WARN_RULES.approachTopIndex; z++)
      for (let dy = -WARN_RULES.near; dy <= WARN_RULES.near; dy++)
        for (let dx = -WARN_RULES.near; dx <= WARN_RULES.near; dx++) {
          const [u, v] = uv(h, z, VY + dy, VX + dx);
          m = Math.max(m, Math.hypot(u, v));
        }
    return m;
  }

  // colour ramp 0..30 m/s
  function ramp(t) {
    t = Math.min(1, Math.max(0, t));
    const stops = [[49,54,149],[69,117,180],[171,217,233],[255,255,191],[253,174,97],[215,48,39]];
    const f = t * (stops.length - 1), i = Math.floor(f), k = f - i;
    const a = stops[Math.min(i, stops.length - 1)], b = stops[Math.min(i + 1, stops.length - 1)];
    return `rgb(${a.map((c, j) => Math.round(c + (b[j] - c) * k)).join(",")})`;
  }
  const VMAX = 30;

  function drawHorizontal(h) {
    const c = $("hcanvas"), g = c.getContext("2d");
    const k = +levelEl.value, cell = c.width / NX;
    g.clearRect(0, 0, c.width, c.height);
    for (let y = 0; y < NY; y++)
      for (let x = 0; x < NX; x++) {
        const [u, v] = uv(h, k, y, x);
        g.fillStyle = ramp(Math.hypot(u, v) / VMAX);
        g.fillRect(x * cell, (NY - 1 - y) * cell, cell + 1, cell + 1);
      }
    // arrows every 10 cells (direction the wind blows toward)
    g.strokeStyle = "rgba(0,0,0,.65)"; g.lineWidth = 1.4;
    for (let y = 5; y < NY; y += 10)
      for (let x = 5; x < NX; x += 10) {
        const [u, v] = uv(h, k, y, x), sp = Math.hypot(u, v) || 1;
        const L = 7 * cell, cx = x * cell + cell / 2, cy = (NY - 1 - y) * cell + cell / 2;
        const ex = cx + (u / sp) * L, ey = cy - (v / sp) * L;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(ex, ey); g.stroke();
      }
    // vertiport marker
    const mx = VX * cell + cell / 2, my = (NY - 1 - VY) * cell + cell / 2;
    g.fillStyle = "#fff"; g.strokeStyle = "#000";
    g.beginPath(); g.arc(mx, my, 9, 0, 2 * Math.PI); g.fill(); g.stroke();
    g.fillStyle = "#000"; g.font = "bold 14px sans-serif"; g.fillText("★", mx - 6, my + 5);
    $("levelLabel").textContent = `${zs[k]} m`;
  }

  // vertical section: returns canvas drawing for fixed slice
  function drawSection(canvasId, h, mode) {
    const c = $("" + canvasId), g = c.getContext("2d");
    const W = c.width, H = c.height, padL = 48, padB = 26, padT = 8, padR = 8;
    const pw = W - padL - padR, ph = H - padT - padB;
    g.clearRect(0, 0, W, H);
    const N = mode === "y" ? NY : NX;
    const cw = pw / N;
    // level rows, equal spacing per level index (non-uniform heights shown via labels)
    const rh = ph / NZ;
    for (let z = 0; z < NZ; z++)
      for (let p = 0; p < N; p++) {
        const [u, v] = mode === "y" ? uv(h, z, p, VX) : uv(h, z, VY, p);
        g.fillStyle = ramp(Math.hypot(u, v) / VMAX);
        g.fillRect(padL + p * cw, padT + (NZ - 1 - z) * rh, cw + 1, rh + 1);
      }
    // vertiport line
    const vx = padL + (mode === "y" ? VY : VX) * cw + cw / 2;
    g.strokeStyle = "#000"; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(vx, padT); g.lineTo(vx, padT + ph); g.stroke(); g.setLineDash([]);
    // axes labels
    g.fillStyle = "#333"; g.font = "11px sans-serif";
    [0, 10, 20, 30, 40, 50, 100, 200, 300, 400, 500, 600].forEach((hm) => {
      const idx = zs.indexOf(hm);
      if (idx >= 0) g.fillText(`${hm} m`, 2, padT + (NZ - 1 - idx) * rh + 10);
    });
    const kmMid = ((N / 2) * 10) / 1000;
    g.fillText(`${(-(N / 2) * 0.01).toFixed(1)} km`, padL, H - 8);
    g.fillText(`${((N / 2) * 0.01).toFixed(1)} km`, W - padR - 40, H - 8);
    g.fillText(mode === "y" ? "남 → 북" : "서 → 동", W / 2 - 22, H - 8);
  }

  function renderTimeline() {
    const box = $("timeline"); box.innerHTML = "";
    const h0 = +hourEl.value;
    for (let h = 0; h <= 48; h++) {
      const m = approachMax(h), st = evaluateWind(m);
      const d = document.createElement("div");
      d.className = `slot ${st.cls}` + (h === h0 ? " cur" : "");
      d.title = `+${h} h · ${m.toFixed(1)} m/s · ${st.label}`;
      d.onclick = () => { hourEl.value = h; render(); };
      box.appendChild(d);
    }
    $("timelineLegend").textContent = "막대 한 칸 = 1시간. 색: 녹색 정상, 노랑 주의, 빨강 경고. 클릭하면 해당 시각으로 이동합니다.";
  }

  function renderWarning(h) {
    const m = approachMax(h), st = evaluateWind(m);
    const b = $("badge");
    b.textContent = st.label; b.className = `badge ${st.cls}`;
    const t = new Date(new Date(startEl.value + ":00Z").getTime() - 9 * 3600e3 + h * 3600e3);
    const kst = new Date(t.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
    $("warnTitle").textContent = `${kst} (KST, +${h} h) · V5 접근 고도 최대 풍속 ${m.toFixed(1)} m/s`;
    $("warnDetail").textContent =
      st.level === 2 ? "지속풍 8.8 m/s(17 kt) 이상: 이·착륙 제한을 검토하십시오." :
      st.level === 1 ? "지속풍 6 m/s 이상: 주의 관찰. 기준 확정 전 잠정 표시입니다." :
      "지속풍 기준 이내. 횡풍·돌풍 기준은 미적용입니다.";
  }

  function render() {
    const h = +hourEl.value;
    $("hourLabel").textContent = `+${h} h`;
    renderWarning(h);
    drawHorizontal(h);
    drawSection("ycanvas", h, "y");
    drawSection("xcanvas", h, "x");
    renderTimeline();
  }

  hourEl.addEventListener("input", render);
  levelEl.addEventListener("change", render);
  startEl.addEventListener("change", render);
  render();
})();
