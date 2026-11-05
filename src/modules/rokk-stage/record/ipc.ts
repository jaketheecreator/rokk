import { invoke } from "@tauri-apps/api/core";
import type { RecordStatus } from "./record";

export const recordStatus = () => invoke<RecordStatus>("record_status");
export const recordRequestPermission = () => invoke<boolean>("record_request_permission");
export const recordOpenSettings = () => invoke<void>("record_open_settings");
export const recordStart = (windowLabel: string, stageOn: boolean, track?: Record<string, unknown>) =>
  invoke<RecordStatus>("record_start", { windowLabel, stageOn, ...track });
export const recordStop = () => invoke<string | null>("record_stop");
export const recordCancel = () => invoke<string | null>("record_cancel");
export const recordDelete = (path: string) => invoke<void>("record_delete", { path });
