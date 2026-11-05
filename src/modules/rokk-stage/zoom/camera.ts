// The camera path for "Save with zoom": the preview's own evaluate() sampled
// at a fixed rate, so the saved video follows exactly what the preview
// shows. Rust only interpolates it (src-tauri/.../rokk_record/zoom_export.rs).

import { evaluate, type ZoomPlan } from "./algo";

/** [t_ms, scale, cx, cy], centers in the mouse path file's video pixels. */
export type CamPoint = [number, number, number, number];

/** The most entries Rust accepts. */
export const MAX_CAMERA_ENTRIES = 80_000;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function point(plan: ZoomPlan, t: number): CamPoint {
  const v = evaluate(plan, t);
  return [r3(t), r3(v.scale), r3(v.cx), r3(v.cy)];
}

/** Samples from t = 0 every 1000 / hz ms, plus a last sample at durationMs.
 * Longer videos are sampled less often so the path stays within
 * MAX_CAMERA_ENTRIES. Times strictly increase. */
export function sampleCameraPath(
  plan: ZoomPlan,
  durationMs: number,
  hz = 120,
): CamPoint[] {
  const end =
    Number.isFinite(durationMs) && durationMs > 0 ? r3(durationMs) : 0;
  const step = Math.max(
    1000 / (hz > 0 ? hz : 120),
    end / (MAX_CAMERA_ENTRIES - 1),
  );
  const out: CamPoint[] = [];
  for (let i = 0; ; i++) {
    const t = r3(i * step);
    if (out.length && t >= end - 0.001) break;
    out.push(point(plan, t));
    if (end === 0) return out;
  }
  out.push(point(plan, end));
  return out;
}
