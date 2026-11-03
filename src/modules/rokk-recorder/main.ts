import "./recorder.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type Action, createRecorder, markup, RECORD_EVENT, type RecordStateEvent } from "./recorder";

const root = document.getElementById("rokk-recorder");
if (root) {
  root.innerHTML = markup();
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const rec = createRecorder((command) => invoke(command), () => motion.matches);
  const dot = root.querySelector<HTMLElement>(".rk-rec-dot");
  const time = root.querySelector<HTMLElement>(".rk-rec-time");
  const live = root.querySelector<HTMLElement>(".rk-rec-sr");
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-action]"));
  const paint = () => {
    const v = rec.view();
    if (time) time.textContent = v.timer;
    if (dot) dot.dataset.on = String(v.dotOn);
    for (const b of buttons) b.disabled = v.busy;
    if (live && v.announce) live.textContent = v.announce;
  };
  for (const b of buttons) {
    b.addEventListener("click", () => {
      const done = rec.press(b.dataset.action as Action);
      paint();
      void done.then(paint);
    });
  }
  void listen<RecordStateEvent>(RECORD_EVENT, ({ payload }) => {
    rec.onEvent(payload);
    paint();
  });
}
