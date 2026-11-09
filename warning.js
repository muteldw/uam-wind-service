// Landing/takeoff wind warning rules for the V5 vertiport.
// Thresholds are DRAFT. Sustained 8.8 m/s (17 kt) follows the RWDI proposal
// (FAA/EASA controllability basis). The 6 m/s caution level is provisional.
// Crosswind, tailwind, gust and turbulence limits are not defined in the source
// and are intentionally absent until the operator confirms them.
const WARN_RULES = {
  caution: 6.0,   // m/s, sustained (10-min mean) — provisional
  warning: 8.8,   // m/s, sustained — 17 kt (RWDI Table 1)
  approachTopIndex: 9, // levels 5..50 m (indices 0..9) = approach layer
  near: 1,        // 3x3 cells around the vertiport centre
};

function evaluateWind(maxSpeed) {
  if (maxSpeed >= WARN_RULES.warning) return { level: 2, label: "경고", cls: "red" };
  if (maxSpeed >= WARN_RULES.caution) return { level: 1, label: "주의", cls: "amber" };
  return { level: 0, label: "정상", cls: "green" };
}
