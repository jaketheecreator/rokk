import { IS_MAC } from "@/lib/platform";
import { enterForRecovery, setRecording } from "../lib/stage";
import { recordStatus } from "./ipc";

/** After a reload: if Rust is still recording, show stage mode again so the
 * user sees what is captured. The menu bar item keeps working either way. */
export async function recoverRecording(): Promise<void> {
  if (!IS_MAC) return;
  try {
    const s = await recordStatus();
    if (s.state === "recording" || s.state === "starting") {
      enterForRecovery();
      setRecording(true);
    }
  } catch {
    // No recorder: nothing to recover.
  }
}
