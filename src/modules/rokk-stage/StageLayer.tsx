import "./stage.css";
import { RokkWordmark } from "@/components/brand/RokkWordmark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  createAutoHide,
  exitStage,
  setControlsVisible,
  setWallpaper,
  takeFirstEntryWarning,
  useStage,
  WALLPAPERS,
  wallpaperById,
  wallpaperUrl,
} from "./lib/stage";

export const STAGE_WARNING = "Stage mode shows your terminal. Check it for secrets before you share your screen.";

/** The wallpaper, the mark and the floating controls. Mounted only while
 * stage mode is on. */
export function StageLayer() {
  const { wallpaper, controlsVisible } = useStage();
  const paper = wallpaperById(wallpaper);
  const hide = useRef<ReturnType<typeof createAutoHide> | null>(null);

  useEffect(() => {
    if (takeFirstEntryWarning()) toast(STAGE_WARNING, { duration: 8000, closeButton: true });
    const h = createAutoHide(setControlsVisible);
    hide.current = h;
    const move = () => h.move();
    window.addEventListener("mousemove", move);
    return () => {
      window.removeEventListener("mousemove", move);
      h.dispose();
      hide.current = null;
      setControlsVisible(true);
    };
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        className="rk-stage-wallpaper"
        style={{ backgroundColor: paper.fallback, backgroundImage: `url(${wallpaperUrl(paper.id)})` }}
      />
      <div aria-hidden="true" className={cn("rk-stage-mark", paper.ink === "dark" ? "rk-ink-dark" : "rk-ink-light")}>
        <span>Made with</span>
        <RokkWordmark height={15} />
      </div>
      <section
        aria-label="Stage controls"
        className="rk-stage-controls"
        data-visible={controlsVisible ? "true" : "false"}
        onFocus={() => hide.current?.focusIn()}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide.current?.focusOut();
        }}
      >
        <button
          type="button"
          className="rk-stage-glass rk-stage-exit"
          // Clear of the macOS traffic lights, which stay visible.
          style={{ left: IS_MAC ? 84 : 16 }}
          onClick={exitStage}
          onMouseEnter={() => hide.current?.hoverIn()}
          onMouseLeave={() => hide.current?.hoverOut()}
        >
          Exit stage
        </button>
        <fieldset
          className="rk-stage-glass rk-stage-picker"
          onMouseEnter={() => hide.current?.hoverIn()}
          onMouseLeave={() => hide.current?.hoverOut()}
        >
          <legend className="sr-only">Wallpaper</legend>
          {WALLPAPERS.map((w) => (
            <Tooltip key={w.id}>
              <TooltipTrigger asChild>
                <label className="rk-stage-thumb" data-selected={w.id === paper.id ? "true" : "false"}>
                  <input
                    type="radio"
                    name="rokk-stage-wallpaper"
                    className="sr-only"
                    aria-label={w.name}
                    checked={w.id === paper.id}
                    onChange={() => setWallpaper(w.id)}
                  />
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: w.fallback, backgroundImage: `url(${wallpaperUrl(w.id)})` }}
                  />
                </label>
              </TooltipTrigger>
              <TooltipContent>{w.name}</TooltipContent>
            </Tooltip>
          ))}
        </fieldset>
      </section>
    </>
  );
}
