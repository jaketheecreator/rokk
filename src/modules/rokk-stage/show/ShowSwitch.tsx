import { useEffect, useRef, useState } from "react";
import { announce, useStage } from "../lib/stage";
import { Popover } from "../Popover";
import { addRecent, chipText, clearRecent, hintFor, type Parsed, parseAddress, prefill, readRecent } from "./address";
import { COMMON_PORTS, createHint, pick, type Show, type ShowTab } from "./show";

export type ShowApi = {
  tabs: readonly ShowTab[];
  activeId: number;
  /** Most recently active tab ids, newest first. */
  mru: readonly number[];
  /** Activates a tab on behalf of the switch. */
  activate: (id: number) => void;
  /** Opens a new preview tab through the app's own function; returns its id. */
  openPreview: (url: string) => number;
  reload: (id: number) => void;
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** "Terminal | Preview" in the stage bottom pill, with the Address popover
 * and the blank-preview hint. Everything here is outside the frame. */
export function ShowSwitch({
  api,
  show,
  onHover,
  open,
  setOpen,
  otherOpen = false,
}: {
  api: ShowApi;
  show: Show;
  onHover: (inside: boolean) => void;
  /** The Address popover; the stage layer keeps one popover open at a time. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Another popover is open: the hint stays hidden. */
  otherOpen?: boolean;
}) {
  const [hint, setHint] = useState(false);
  const { recording } = useStage();
  const portButton = useRef<HTMLButtonElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const hinter = useRef<ReturnType<typeof createHint> | null>(null);
  useEffect(() => {
    hinter.current = createHint(setHint);
    return () => hinter.current?.dispose();
  }, []);
  // Keep the controls up while the hint is showing.
  useEffect(() => {
    if (!hint) return;
    onHover(true);
    return () => onHover(false);
  }, [hint, onHover]);

  const active = api.tabs.find((t) => t.id === api.activeId);
  const url = show === "preview" ? active?.url : undefined;

  const chooseTerminal = () => {
    const id = pick(api.tabs, api.mru, "terminal");
    if (id !== null) api.activate(id);
    setOpen(false);
  };
  const choosePreview = () => {
    if (show === "preview") return;
    const id = pick(api.tabs, api.mru, "preview");
    if (id !== null) {
      api.activate(id);
      hinter.current?.show();
    } else setOpen(true);
  };
  const submit = (a: Extract<Parsed, { ok: true }>) => {
    addRecent(storage(), a.url);
    const norm = (u?: string) => {
      const p = parseAddress(u ?? "");
      return p.ok ? p.url : null;
    };
    const existing = api.tabs.find((t) => t.kind === "preview" && norm(t.url) === a.url);
    api.activate(existing ? existing.id : api.openPreview(a.url));
    setOpen(false);
    announce(`Preview: ${a.display}`);
    hinter.current?.show();
  };

  return (
    <div className="rk-stage-show">
      {open ? (
        <Popover label="Address" trigger={show === "preview" ? portButton : previewButton} onClose={() => setOpen(false)}>
          <AddressPopover onSubmit={submit} onCancel={() => setOpen(false)} />
        </Popover>
      ) : hint && !otherOpen && !recording ? (
        <p className="rk-stage-glass rk-stage-hint" role="status">
          {hintFor(url)}
        </p>
      ) : null}
      <fieldset className="rk-stage-seg" aria-label="Show">
        <legend className="sr-only">Show</legend>
        <button type="button" aria-pressed={show === "terminal"} onClick={chooseTerminal}>
          <svg className="rk-seg-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <path d="m5 8 4 4-4 4M12 17h7" />
          </svg>
          <span className="rk-seg-label">Terminal</span>
        </button>
        <button
          ref={previewButton}
          type="button"
          aria-pressed={show === "preview"}
          aria-haspopup="dialog"
          aria-expanded={open && show !== "preview"}
          onClick={choosePreview}
        >
          <svg className="rk-seg-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <path d="M4 5h16v14H4zM4 9h16" />
          </svg>
          <span className="rk-seg-label">Preview</span>
        </button>
      </fieldset>
      {show === "preview" ? (
        <>
          <button
            ref={portButton}
            type="button"
            className="rk-stage-iconbtn"
            aria-label="Change address"
            title="Change address"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {/* Inline icons: the icon set's path data is large for this chunk. */}
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
            </svg>
          </button>
          <button type="button" className="rk-stage-iconbtn" aria-label="Reload preview" title="Reload preview" onClick={() => api.reload(api.activeId)}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />
            </svg>
          </button>
          <button type="button" className="rk-stage-textbtn" onClick={() => hinter.current?.show()}>
            Blank?
          </button>
        </>
      ) : null}
    </div>
  );
}

/** Enter and "Show it": the parsed address, or the error to show. */
export function submitDraft(draft: string, onSubmit: (a: Extract<Parsed, { ok: true }>) => void): string | null {
  const p = parseAddress(draft);
  if (!p.ok) return p.message;
  onSubmit(p);
  return null;
}

export function AddressPopover({ onSubmit, onCancel }: { onSubmit: (a: Extract<Parsed, { ok: true }>) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(() => prefill(storage()));
  const [recent, setRecent] = useState(() => readRecent(storage()));
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className="rk-stage-popover"
      onSubmit={(e) => {
        e.preventDefault();
        setError(submitDraft(draft, onSubmit));
      }}
    >
      <label className="rk-stage-popover-label" htmlFor="rk-stage-address">
        Address
      </label>
      <div className="rk-stage-port">
        <input
          ref={input}
          id="rk-stage-address"
          inputMode="url"
          autoCapitalize="off"
          spellCheck={false}
          autoComplete="off"
          placeholder="3000 or https://yoursite.com"
          data-autofocus=""
          aria-invalid={error ? true : undefined}
          aria-describedby="rk-stage-address-help"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
        />
      </div>
      <p id="rk-stage-address-help" className="rk-stage-popover-help">
        A port opens localhost. Or paste a full address.
      </p>
      {error ? (
        <p className="rk-stage-popover-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="rk-stage-chips">
        {COMMON_PORTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setDraft(chipText(p));
              input.current?.focus();
            }}
            aria-pressed={draft.trim() === chipText(p)}
          >
            {p}
          </button>
        ))}
      </div>
      {recent.length ? (
        <div className="rk-stage-recent">
          <span>Recent</span>
          <button
            type="button"
            className="rk-stage-textbtn"
            onClick={() => {
              clearRecent(storage());
              setRecent([]);
            }}
          >
            Clear
          </button>
          {recent.map((u) => {
            const p = parseAddress(u);
            return p.ok ? (
              <button key={u} type="button" title={u} onClick={() => onSubmit(p)}>
                {p.display}
              </button>
            ) : null;
          })}
        </div>
      ) : null}
      <div className="rk-stage-popover-actions">
        <button type="button" className="rk-stage-textbtn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="rk-stage-primary">
          Show it
        </button>
      </div>
    </form>
  );
}
