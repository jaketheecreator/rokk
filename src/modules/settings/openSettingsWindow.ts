import { invoke } from "@tauri-apps/api/core";

export type SettingsTab =
  | "general"
  | "editor"
  | "themes"
  | "shortcuts"
  | "models"
  | "agents"
  | "guards"
  | "about";

export async function openSettingsWindow(tab?: SettingsTab): Promise<void> {
  // The mode this window resolved, so Settings opens on the same color.
  const dark =
    typeof document === "undefined"
      ? null
      : document.documentElement.classList.contains("dark");
  await invoke("open_settings_window", { tab: tab ?? null, dark });
}
