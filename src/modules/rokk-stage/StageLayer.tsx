import "./stage.css";
import { RokkWordmark } from "@/components/brand/RokkWordmark";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { createAutoHide, exitStage, setControlsVisible, takeFirstEntryWarning, useStage, wallpaperById, wallpaperUrl } from "./lib/stage";
import { popover } from "./controls";
import { FrameSize } from "./frame/FrameSize";
import { WallpaperPicker } from "./WallpaperPicker";
import { restoreOnExit, type ShowTab, showOf, touch } from "./show/show";
import { isExternal } from "./show/address";
import { type ShowApi, ShowSwitch } from "./show/ShowSwitch";

const RecordControls = IS_MAC ? lazy(() => import("./record/RecordControls")) : null;

export const STAGE_WARNING = "Stage mode shows your terminal. Check it for secrets before you share your screen.";

/** The app's tabs, as the stage "Show" switch needs them. */
export type StageTabs = {
  tabs: readonly ShowTab[];
  activeId: number;
  activate: (id: number) => void;
  openPreview: (url: string) => number;
  reload: (id: number) => void;
};

/** The wallpaper, the mark and the floating controls. Mounted only while
 * stage mode is on. */
export function StageLayer(props: Partial<StageTabs>) {
  const { wallpaper, controlsVisible } = useStage();
  const paper = wallpaperById(wallpaper);
  const hide = useRef<ReturnType<typeof createAutoHide> | null>(null);
  const tabs = props.tabs ?? [];
  const activeId = props.activeId ?? -1;
  const show = showOf(tabs, activeId);
  // Tab recency while on stage, the tab active on entry, and the last tab the
  // Show switch chose (for the restore rule on exit).
  const [mru, setMru] = useState<number[]>(() => (activeId >= 0 ? [activeId] : []));
  const entry = useRef(activeId);
  const lastSwitch = useRef<number | null>(null);
  // One popover at a time; while one is open the controls stay up.
  const [pop, dispatch] = useReducer(popover, null);
  const held = useRef(false);
  useEffect(() => {
    if (pop) {
      held.current = true;
      hide.current?.hoverIn();
    } else if (held.current) {
      held.current = false;
      hide.current?.hoverOut();
    }
  }, [pop]);
  // Lets stage.css drop the frame's background and hairlines for a preview.
  useEffect(() => {
    document.documentElement.dataset.rokkShow = show;
    return () => {
      delete document.documentElement.dataset.rokkShow;
    };
  }, [show]);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    if (activeId >= 0) setMru((m) => touch(m, activeId));
  }, [activeId]);
  useEffect(
    () => () => {
      const p = latest.current;
      if (!p.activate || p.activeId === undefined) return;
      const back = restoreOnExit({
        entryId: entry.current,
        activeId: p.activeId,
        lastSwitchId: lastSwitch.current,
        exists: (id) => (p.tabs ?? []).some((t) => t.id === id),
      });
      if (back !== null) p.activate(back);
    },
    [],
  );
  const activate = useCallback((id: number) => {
    lastSwitch.current = id;
    latest.current.activate?.(id);
  }, []);
  const onShowHover = useCallback((inside: boolean) => (inside ? hide.current?.hoverIn() : hide.current?.hoverOut()), []);
  const api: ShowApi | null =
    props.activate && props.openPreview && props.reload
      ? {
          tabs,
          activeId,
          mru,
          activate,
          openPreview: props.openPreview,
          reload: props.reload,
        }
      : null;

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
        style={{
          backgroundColor: paper.fallback,
          backgroundImage: `url(${wallpaperUrl(paper.id)})`,
        }}
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
        <FrameSize />
        {/* biome-ignore lint/a11y/noStaticElementInteractions: hover only pauses the auto-hide; the controls inside are the interactive elements. */}
        <div
          className="rk-stage-glass rk-stage-bottom"
          onMouseEnter={() => hide.current?.hoverIn()}
          onMouseLeave={() => {
            if (!held.current) hide.current?.hoverOut();
          }}
        >
          {api ? (
            <>
              <ShowSwitch
                api={api}
                show={show}
                onHover={onShowHover}
                open={pop === "port"}
                setOpen={(o) => dispatch(o ? { type: "open", id: "port" } : { type: "close" })}
                otherOpen={pop === "wallpaper"}
              />
              <span aria-hidden="true" className="rk-stage-div" />
            </>
          ) : null}
          <WallpaperPicker current={paper.id} open={pop === "wallpaper"} setOpen={(o) => dispatch(o ? { type: "open", id: "wallpaper" } : { type: "close" })} />
          {RecordControls ? (
            <>
              <span aria-hidden="true" className="rk-stage-div" />
              <Suspense fallback={null}>
                <RecordControls show={show} external={show === "preview" && isExternal(api?.tabs.find((t) => t.id === api.activeId)?.url)} onHover={() => {}} />
              </Suspense>
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}
