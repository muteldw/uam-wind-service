// V5 vertiport wind viewer. Loads one model case (base.bin) and mask.bin
// (building cells). Applies a DEMO time evolution (scale + veer), which is synthetic.
(async function () {
  const meta = await (await fetch("data/meta.json")).json();
  const [rawBuf, maskBuf] = await Promise.all([
    fetch("data/base.bin").then((r) => r.arrayBuffer()),
    fetch("data/mask.bin").then((r) => r.arrayBuffer()),
  ]);
  const raw = new Int16Array(rawBuf);
  const MASK = new Uint8Array(maskBuf);
  const [NV, NZ, NY, NX] = meta.shape;
  const SC = meta.scale;
  const VX = meta.x_index_vertiport, VY = meta.y_index_vertiport;
  const GRID = meta.grid_m;
  const zs = meta.z;
  const VMAX = 30;                 // colour ramp 0..30 m/s
  const ARROW_PX = 18;             // arrow length in px for 10 m/s (map)
  const ARROW_CAP = 30;            // maximum arrow length in px (map)
  const SEC_PX = 20;               // arrow length in px for 10 m/s (sections)
  const SPACING = 8;               // map arrows every 8 cells

  const $ = (id) => document.getElementById(id);
  const hourEl = $("hour"), levelEl = $("level"), startEl = $("startTime");
  const playBtn = $("play");
  const state = { playing: false, speed: 1, timer: null };

  // default start: now (KST, rounded to hour)
  const now = new Date(Date.now() + 9 * 3600e3);
  now.setUTCMinutes(0, 0, 0);
  startEl.value = now.toISOString().slice(0, 16);

  // ---- level UI: select + vertical scroll list (top = highest) ----
  zs.forEach((z, k) => {
    const o = document.createElement("option");
    o.value = k; o.textContent = `${z} m`;
    levelEl.appendChild(o);
  });
  levelEl.value = 0;
  const levelList = $("levelList");
  for (let k = zs.length - 1; k >= 0; k--) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${zs[k]} m`;
    b.dataset.k = k;
    b.setAttribute("role", "option");
    b.onclick = () => setLevel(k);
    levelList.appendChild(b);
  }

  // ---- colour bar ----
  const RAMP_STOPS = [[49, 54, 149], [69, 117, 180], [171, 217, 233], [255, 255, 191], [253, 174, 97], [215, 48, 39]];
  function ramp(t) {
    t = Math.min(1, Math.max(0, t));
    const f = t * (RAMP_STOPS.length - 1), i = Math.floor(f), k = f - i;
    const a = RAMP_STOPS[Math.min(i, RAMP_STOPS.length - 1)], b = RAMP_STOPS[Math.min(i + 1, RAMP_STOPS.length - 1)];
    return `rgb(${a.map((c, j) => Math.round(c + (b[j] - c) * k)).join(",")})`;
  }
  (function drawColorbar() {
    const c = $("cbar"), g = c.getContext("2d");
    for (let x = 0; x < c.width; x++) {
      g.fillStyle = ramp(x / (c.width - 1));
      g.fillRect(x, 0, 1, c.height);
    }
    const ticks = $("ticks");
    [0, 5, 10, 15, 20, 25, 30].forEach((v) => {
      const s = document.createElement("span");
      s.style.left = `${(v / VMAX) * 100}%`;
      s.textContent = v;
      ticks.appendChild(s);
    });
    // threshold markers on the colour bar
    [[WARN_RULES.caution, "주의 6"], [WARN_RULES.warning, "경고 8.8"]].forEach(([v, label]) => {
      const x = (v / VMAX) * c.width;
      g.fillStyle = "#fff"; g.fillRect(x - 1, 0, 2, c.height);
      g.fillStyle = "#000"; g.font = "11px sans-serif";
      g.fillText(label, Math.min(x + 3, c.width - 42), c.height - 6);
    });
  })();

  // ---- demo time evolution (synthetic): scale and veer over 24 h cycle ----
  const FAC = [];
  for (let h = 0; h <= 48; h++) {
    const ph = (2 * Math.PI * h) / 24;
    const s = 1 + 0.2 * Math.sin(ph + Math.PI / 3);
    const d = ((10 * Math.sin(ph)) * Math.PI) / 180;
    FAC.push({ s, c: Math.cos(d), n: Math.sin(d) });
  }

  const IDX3 = (v, z, y, x) => ((v * NZ + z) * NY + y) * NX + x;
  const IDX2 = (z, y, x) => (z * NY + y) * NX + x;
  const isB = (z, y, x) => MASK[IDX2(z, y, x)] === 1;

  // horizontal wind (u,v) and vertical wind w at hour h
  function uv(h, z, y, x) {
    const f = FAC[h];
    const u0 = raw[IDX3(0, z, y, x)] * SC, v0 = raw[IDX3(1, z, y, x)] * SC;
    return [f.s * (u0 * f.c - v0 * f.n), f.s * (u0 * f.n + v0 * f.c)];
  }
  function wz(h, z, y, x) {
    return FAC[h].s * raw[IDX3(2, z, y, x)] * SC;
  }

  // max horizontal speed in approach layer near vertiport (building cells skipped)
  function approachMax(h) {
    let m = 0;
    for (let z = 0; z <= WARN_RULES.approachTopIndex; z++)
      for (let dy = -WARN_RULES.near; dy <= WARN_RULES.near; dy++)
        for (let dx = -WARN_RULES.near; dx <= WARN_RULES.near; dx++) {
          const y = VY + dy, x = VX + dx;
          if (isB(z, y, x)) continue;
          const [u, v] = uv(h, z, y, x);
          m = Math.max(m, Math.hypot(u, v));
        }
    return m;
  }

  // hatch pattern for building cells: grey with X
  const HATCH = (() => {
    const pc = document.createElement("canvas");
    pc.width = pc.height = 8;
    const pg = pc.getContext("2d");
    pg.fillStyle = getCss("--blk", "#8c929c");
    pg.fillRect(0, 0, 8, 8);
    pg.strokeStyle = "#3d424a"; pg.lineWidth = 1;
    pg.beginPath(); pg.moveTo(0, 0); pg.lineTo(8, 8); pg.moveTo(8, 0); pg.lineTo(0, 8); pg.stroke();
    return pc;
  })();
  function getCss(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function fillBuilding(g, x, y, w, h) {
    g.fillStyle = g.createPattern(HATCH, "repeat");
    g.fillRect(x, y, w, h);
  }

  // arrow with dark halo so it is visible on any colour
  function drawArrow(g, cx, cy, ux, uy, len) {
    if (len < 2) return;
    const x2 = cx + ux * len, y2 = cy + uy * len;
    g.lineCap = "round";
    g.strokeStyle = "#000"; g.lineWidth = 3.2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = "#fff"; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(x2, y2); g.stroke();
    const hs = Math.min(6, len * 0.45), px = -uy, py = ux;
    g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x2, y2);
    g.lineTo(x2 - ux * hs + px * hs * 0.55, y2 - uy * hs + py * hs * 0.55);
    g.lineTo(x2 - ux * hs - px * hs * 0.55, y2 - uy * hs - py * hs * 0.55);
    g.closePath(); g.fill(); g.stroke();
  }

  function drawHorizontal(h) {
    const c = $("hcanvas"), g = c.getContext("2d");
    const k = +levelEl.value, cell = c.width / NX;
    g.clearRect(0, 0, c.width, c.height);
    for (let y = 0; y < NY; y++)
      for (let x = 0; x < NX; x++) {
        const px = x * cell, py = (NY - 1 - y) * cell;
        if (isB(k, y, x)) { fillBuilding(g, px, py, cell + 1, cell + 1); continue; }
        const [u, v] = uv(h, k, y, x);
        g.fillStyle = ramp(Math.hypot(u, v) / VMAX);
        g.fillRect(px, py, cell + 1, cell + 1);
      }
    // horizontal wind arrows
    for (let y = SPACING / 2; y < NY; y += SPACING)
      for (let x = SPACING / 2; x < NX; x += SPACING) {
        if (isB(k, y, x)) continue;
        const [u, v] = uv(h, k, y, x), sp = Math.hypot(u, v);
        if (sp < 0.3) continue;
        const cx = x * cell + cell / 2, cy = (NY - 1 - y) * cell + cell / 2;
        const len = Math.min((sp / 10) * ARROW_PX, ARROW_CAP);
        drawArrow(g, cx, cy, u / sp, -v / sp, len);
      }
    // vertiport marker
    const mx = VX * cell + cell / 2, my = (NY - 1 - VY) * cell + cell / 2;
    g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.beginPath(); g.arc(mx, my, 9, 0, 2 * Math.PI); g.fill(); g.stroke();
    g.fillStyle = "#000"; g.font = "bold 14px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("★", mx, my + 1);
    // reference arrow (10 m/s) in top-right box
    const bx = c.width - 176, by = 10;
    g.fillStyle = "rgba(255,255,255,.9)"; g.strokeStyle = "#333"; g.lineWidth = 1;
    g.fillRect(bx, by, 166, 40); g.strokeRect(bx, by, 166, 40);
    drawArrow(g, bx + 12, by + 20, 1, 0, ARROW_PX);
    g.fillStyle = "#111"; g.font = "13px sans-serif"; g.textAlign = "left";
    g.fillText("= 10 m/s (길이 기준)", bx + 12 + ARROW_PX + 10, by + 20);
    // building key
    const kx = c.width - 176, ky = by + 48;
    g.fillStyle = "rgba(255,255,255,.9)"; g.fillRect(kx, ky, 166, 26);
    fillBuilding(g, kx + 8, ky + 5, 16, 16);
    g.strokeStyle = "#333"; g.strokeRect(kx + 8, ky + 5, 16, 16);
    g.fillStyle = "#111"; g.font = "13px sans-serif";
    g.fillText("건물 (바람 없음)", kx + 30, ky + 13);
    g.textBaseline = "alphabetic";
    $("levelLabel").textContent = `${zs[k]} m`;
    markLevelList(k);
  }

  // vertical section (standard orientation: height up)
  // mode "y": horizontal axis = y (south→north) at x=VX, in-plane wind (v, w)
  // mode "x": horizontal axis = x (west→east) at y=VY, in-plane wind (u, w)
  function drawSection(canvasId, h, mode) {
    const c = $(canvasId), g = c.getContext("2d");
    const W = c.width, H = c.height, padL = 46, padB = 30, padT = 10, padR = 10;
    const pw = W - padL - padR, ph = H - padT - padB;
    g.clearRect(0, 0, W, H);
    const N = mode === "y" ? NY : NX;
    const cw = pw / N, rh = ph / NZ;
    const rowY = (z) => padT + (NZ - 1 - z) * rh;      // row top for level z
    const colX = (p) => padL + p * cw;                  // column left for position p

    // cells: colour = horizontal speed, building = hatch
    for (let z = 0; z < NZ; z++)
      for (let p = 0; p < N; p++) {
        const y = mode === "y" ? p : VY, x = mode === "y" ? VX : p;
        if (isB(z, y, x)) { fillBuilding(g, colX(p), rowY(z), cw + 1, rh + 1); continue; }
        const [u, v] = uv(h, z, y, x);
        g.fillStyle = ramp(Math.hypot(u, v) / VMAX);
        g.fillRect(colX(p), rowY(z), cw + 1, rh + 1);
      }

    // in-plane wind arrows
    for (let p = SPACING / 2; p < N; p += SPACING)
      for (let z = 0; z < NZ; z++) {
        const y = mode === "y" ? p : VY, x = mode === "y" ? VX : p;
        if (isB(z, y, x)) continue;
        const [u, v] = uv(h, z, y, x), w = wz(h, z, y, x);
        const hx = mode === "y" ? v : u;               // in-plane horizontal
        const sp = Math.hypot(hx, w);
        if (sp < 0.05) continue;
        const cx = colX(p) + cw / 2, cy = rowY(z) + rh / 2;
        const len = Math.min((sp / 10) * SEC_PX, Math.max(8, rh * 0.85));
        drawArrow(g, cx, cy, hx / sp, -w / sp, len);
      }

    // vertiport line
    const vx = colX(mode === "y" ? VY : VX) + cw / 2;
    g.strokeStyle = "#000"; g.lineWidth = 1; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(vx, padT); g.lineTo(vx, padT + ph); g.stroke(); g.setLineDash([]);

    // height labels
    g.fillStyle = "#333"; g.font = "11px sans-serif"; g.textAlign = "right"; g.textBaseline = "middle";
    zs.forEach((hm, idx) => {
      if ([5, 10, 20, 30, 50, 100, 200, 300, 400, 500, 600].includes(hm))
        g.fillText(`${hm}`, padL - 5, rowY(idx) + rh / 2);
    });
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.save(); g.translate(12, padT + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = "center";
    g.fillText("고도 (m)", 0, 0); g.restore();

    // horizontal axis: distance from vertiport (km)
    const kmAt = (p) => ((p - (mode === "y" ? VY : VX)) * GRID) / 1000;
    g.textAlign = "left"; g.fillStyle = "#333";
    g.fillText(`${kmAt(0).toFixed(2)} km`, padL, H - 10);
    g.textAlign = "right";
    g.fillText(`${kmAt(N - 1).toFixed(2)} km`, W - padR, H - 10);
    g.textAlign = "center";
    g.fillText(mode === "y" ? "남 ← 거리 → 북 (V5 기준)" : "서 ← 거리 → 동 (V5 기준)", padL + pw / 2, H - 10);
    g.textBaseline = "alphabetic";
  }

  function renderTimeline(h0) {
    const box = $("timeline"); box.innerHTML = "";
    for (let h = 0; h <= 48; h++) {
      const m = approachMax(h), st = evaluateWind(m);
      const d = document.createElement("div");
      d.className = `slot ${st.cls}` + (h === h0 ? " cur" : "");
      d.title = `+${h} h · ${m.toFixed(1)} m/s · ${st.label}`;
      d.onclick = () => setHour(h);
      box.appendChild(d);
    }
    $("timelineLegend").textContent = "막대 한 칸 = 1시간. 색: 녹색 정상, 노랑 주의, 빨강 경고. 클릭하면 해당 시각으로 이동합니다.";
  }

  function renderWarning(h) {
    const m = approachMax(h), st = evaluateWind(m);
    const b = $("badge");
    b.textContent = st.label; b.className = `badge ${st.cls}`;
    const base = Date.parse(startEl.value + ":00Z");
    const kst = new Date(base + h * 3600e3).toISOString().slice(0, 16).replace("T", " ");
    $("warnTitle").textContent = `${kst} (KST, +${h} h) · V5 접근 고도 최대 수평풍속 ${m.toFixed(1)} m/s`;
    $("warnDetail").textContent =
      st.level === 2 ? "지속풍 8.8 m/s(17 kt) 이상: 이·착륙 제한을 검토하십시오." :
      st.level === 1 ? "지속풍 6 m/s 이상: 주의 관찰. 기준 확정 전 잠정 표시입니다." :
      "지속풍 기준 이내. 횡풍·돌풍 기준은 미적용입니다.";
  }

  function markLevelList(k) {
    levelList.querySelectorAll("button").forEach((b) => {
      const on = +b.dataset.k === k;
      b.setAttribute("aria-selected", on ? "true" : "false");
      if (on) b.scrollIntoView({ block: "nearest" });
    });
  }

  function render() {
    const h = +hourEl.value;
    $("hourLabel").textContent = `+${h} h`;
    renderWarning(h);
    drawHorizontal(h);
    drawSection("ycanvas", h, "y");
    drawSection("xcanvas", h, "x");
    renderTimeline(h);
  }

  function setHour(h) {
    hourEl.value = Math.max(0, Math.min(48, h));
    render();
  }
  function setLevel(k) {
    levelEl.value = k;
    render();
  }

  // ---- play / speed ----
  function setPlaying(on) {
    state.playing = on;
    playBtn.textContent = on ? "⏸ 정지" : "▶ 재생";
    playBtn.setAttribute("aria-pressed", on ? "true" : "false");
    clearInterval(state.timer);
    if (on) {
      state.timer = setInterval(() => {
        let h = +hourEl.value + 1;
        if (h > 48) h = 0;
        setHour(h);
      }, 1000 / state.speed);
    }
  }
  function setSpeed(sp) {
    state.speed = sp;
    document.querySelectorAll("[data-speed]").forEach((b) => {
      const on = +b.dataset.speed === sp;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (state.playing) setPlaying(true);
  }
  playBtn.addEventListener("click", () => setPlaying(!state.playing));
  document.querySelectorAll("[data-speed]").forEach((b) =>
    b.addEventListener("click", () => setSpeed(+b.dataset.speed))
  );

  // ---- keyboard: ← → move one hour, Space toggles play ----
  document.addEventListener("keydown", (e) => {
    const t = e.target, tag = t.tagName;
    if (t === hourEl) return;                                         // native range handles arrows
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setHour(+hourEl.value + (e.key === "ArrowRight" ? 1 : -1));
    } else if (e.key === " " && tag === "BODY") {
      e.preventDefault();
      setPlaying(!state.playing);
    }
  });

  hourEl.addEventListener("input", render);
  levelEl.addEventListener("change", () => setLevel(+levelEl.value));
  startEl.addEventListener("change", render);
  render();
})();
