import { invoke } from "@tauri-apps/api/core";
import type { GuardScore, GuardStatus, Sensitivity, WeekStats } from "./guards";

export const guardStatus = () => invoke<GuardStatus>("guard_status");
export const guardEnable = (sensitivity: Sensitivity) =>
  invoke<GuardStatus>("guard_enable", { sensitivity });
export const guardDisable = () => invoke<GuardStatus>("guard_disable");
export const guardRemoveAll = () => invoke<GuardStatus>("guard_remove_all");
export const guardSetSensitivity = (sensitivity: Sensitivity) =>
  invoke<GuardStatus>("guard_set_sensitivity", { sensitivity });
export const guardScore = (prompt: string, sensitivity: Sensitivity) =>
  invoke<GuardScore>("guard_score", { prompt, sensitivity });
export const guardStats = () => invoke<WeekStats | null>("guard_stats");
