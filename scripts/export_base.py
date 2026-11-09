"""NetCDF(sensitivity case) -> compact binary for the web app.
Usage: python3 scripts/export_base.py <input.nc> <outdir>
Writes base.bin (int16, scale 0.01 m/s, order: var[u,v,w], z, y, x) and meta.json.
"""
import sys, json, os
import numpy as np, netCDF4 as nc

src, outdir = sys.argv[1], sys.argv[2]
d = nc.Dataset(src)
vars_ = ["u", "v", "w"]
arr = np.stack([np.ma.filled(d.variables[v][0], 0.0) for v in vars_]).astype(np.float64)  # (3, z, y, x)
arr = np.nan_to_num(arr, nan=0.0)
q = np.clip(np.round(arr * 100), -32767, 32767).astype("<i2")
os.makedirs(outdir, exist_ok=True)
q.tofile(os.path.join(outdir, "base.bin"))
meta = {
    "vars": vars_, "shape": list(q.shape), "scale": 0.01,
    "z": [float(v) for v in d.variables["z"][:]],
    "x_index_vertiport": 84, "y_index_vertiport": 74,   # 0-based (1-based 85,75)
    "grid_m": 10.0, "source": os.path.basename(src),
    "note": "Single model case (MUKLIMO_3 sensitivity, 12 m/s, from 0 deg). Not a time series.",
}
json.dump(meta, open(os.path.join(outdir, "meta.json"), "w"), ensure_ascii=False, indent=2)
print(json.dumps(meta, ensure_ascii=False)[:300])
