import { invoke } from "@tauri-apps/api/core";
import type { MeterSnapshot, SessionMatch } from "./meter";

export const meterFindSession = (projectDir: string, sinceMs: number) =>
  invoke<SessionMatch | null>("meter_find_session", { projectDir, sinceMs: Math.max(0, Math.floor(sinceMs)) });

export const meterRead = (sessionId: string, projectDir: string, offset: number) =>
  invoke<MeterSnapshot>("meter_read", { sessionId, projectDir, offset });
