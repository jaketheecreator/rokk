import { useRef } from "react";
import { gridMove } from "./controls";
import { announce, setWallpaper, WALLPAPERS, type WallpaperId, wallpaperById, wallpaperUrl } from "./lib/stage";
import { Popover } from "./Popover";

const thumb = (id: WallpaperId) => {
  const w = wallpaperById(id);
  return { backgroundColor: w.fallback, backgroundImage: `url(${wallpaperUrl(w.id)})` };
};

/** One button with the current wallpaper; a popover with a 3 by 2 grid. */
export function WallpaperPicker({
  current,
  open,
  setOpen,
}: {
  current: WallpaperId;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const pick = (i: number) => {
    const w = WALLPAPERS[i];
    setWallpaper(w.id);
    announce(`Wallpaper: ${w.name}`);
    setOpen(false);
  };
  return (
    <div className="rk-stage-wp">
      {open ? (
        <Popover label="Wallpaper" trigger={button} onClose={() => setOpen(false)}>
          <div
            ref={grid}
            role="radiogroup"
            aria-label="Wallpaper"
            className="rk-stage-wp-grid"
            onKeyDown={(e) => {
              const items = Array.from(grid.current?.querySelectorAll<HTMLElement>("[role=radio]") ?? []);
              const next = gridMove(items.indexOf(e.target as HTMLElement), e.key, items.length, 3);
              if (next === null) return;
              e.preventDefault();
              items[next]?.focus();
            }}
          >
            {WALLPAPERS.map((w, i) => (
              // biome-ignore lint/a11y/useSemanticElements: thumbnail buttons in a radiogroup with roving focus; a native radio cannot hold the 112 by 72 preview.
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={w.id === current}
                tabIndex={w.id === current ? 0 : -1}
                data-autofocus={w.id === current ? "" : undefined}
                onClick={() => pick(i)}
              >
                <span aria-hidden="true" style={thumb(w.id)} />
                {w.name}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
      <button
        ref={button}
        type="button"
        className="rk-stage-wp-btn"
        aria-label={`Wallpaper: ${wallpaperById(current).name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true" style={thumb(current)} />
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
    </div>
  );
}
