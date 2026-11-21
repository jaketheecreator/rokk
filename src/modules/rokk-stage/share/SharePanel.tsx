import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  type ComponentProps,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  captionLength,
  charLength,
  checksFor,
  composeUrl,
  formatBytes,
  formatDuration,
  type Meta,
  PLATFORM_IDS,
  PLATFORMS,
  type PlatformId,
  sizeLimit,
} from "./platforms";
import {
  allowed,
  applyLink,
  type Browser,
  choice,
  NOT_FOUND,
  type Profile,
  asError,
  baseName,
  CONFIRM_TEXT,
  checkLink,
  clampRange,
  estimateBytes,
  GIF_MAX_MS,
  IDLE,
  type JobView,
  type CaptionKey,
  readRemembered,
  type Remembered,
  reduceJob,
  type ShareEvent,
  setCredit,
  smallerRate,
  writeRemembered,
} from "./share";
import "./share.css";

type Info = Meta & { path: string };
type Saved = { output: string; size: number; width: number; height: number };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** One check line: a green tick or an amber triangle, with plain text. */
export const TICK_FIRST = "Tick the box above first";

/** The main action: the only filled button. Always shown; until the
 * secrets box is ticked it is dimmed, aria-disabled and says why. */
export function PostButton({
  id,
  confirmed,
  opened,
  onPost,
  where,
}: {
  id: PlatformId;
  confirmed: boolean;
  opened: boolean;
  onPost: () => void;
  /** "Opens in <Browser> (<Profile>)...", when one is chosen. */
  where?: string | null;
}) {
  "use no memo";
  const p = PLATFORMS[id];
  return (
    <div className="rk-share-post">
      <button
        type="button"
        className="rk-share-main"
        aria-disabled={!confirmed}
        aria-describedby="rk-share-post-help"
        onClick={() => confirmed && onPost()}
      >
        {p.compose.label}
        <span aria-hidden="true">{"\u2197"}</span>
      </button>
      {confirmed ? null : <p className="rk-share-note">{TICK_FIRST}</p>}
      <p
        id="rk-share-post-help"
        className="rk-share-note"
        aria-live="polite"
        data-done={opened || undefined}
      >
        {opened
          ? `${p.name} opened in your browser.`
          : (where ?? p.compose.note)}
      </p>
    </div>
  );
}

/** A plain panel button; className may add to the default. */
function Btn(props: ComponentProps<"button">) {
  "use no memo";
  return <button type="button" className="rk-share-btn" {...props} />;
}

/** "Saved <name>, <details>." with Show in Finder. */
function SavedRow({ path, text }: { path: string; text: string }) {
  "use no memo";
  return (
    <div className="rk-share-row">
      <p className="rk-share-note" role="status">
        Saved {baseName(path)}, {text}.
      </p>
      <Btn onClick={() => void revealItemInDir(path)}>Show in Finder</Btn>
    </div>
  );
}

function Counter({
  n,
  limit,
  rule,
}: {
  n: number;
  limit: number;
  rule: string;
}) {
  "use no memo";
  return (
    <p className="rk-share-note" data-over={n > limit}>
      {n} / {limit}. {rule}
    </p>
  );
}

/** "Share": prepares a post for X, LinkedIn or YouTube. Nothing is posted
 * or uploaded; the person finishes in the browser. */
export default function SharePanel({
  path,
  onClose,
  opener,
}: {
  path: string;
  onClose: () => void;
  opener: () => HTMLElement | null;
}) {
  "use no memo";
  const store = storage();
  const file = path;
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mem, setMem] = useState<Remembered>(() => readRemembered(store));
  const { tab, captions } = mem;
  const [linkInput, setLinkInput] = useState(mem.link);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Unchecked every time the panel opens: never remembered.
  const [confirmed, setConfirmed] = useState(false);
  const [time, setTime] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, GIF_MAX_MS]);
  const [job, setJob] = useState<JobView>(IDLE);
  const [poster, setPoster] = useState<Saved | "busy" | null>(null);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [browsers, setBrowsers] = useState<Browser[] | null>(null);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  // The platform whose page the main button opened, for the confirmation.
  const [opened, setOpened] = useState<PlatformId | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const jobRef = useRef<JobView>(IDLE);
  const drag = useRef<{ x: number; y: number; sent: boolean } | null>(null);

  const setView = (next: JobView) => {
    jobRef.current = next;
    setJob(next);
  };

  // The event listener is set up once; it calls the latest setView.
  const viewLatest = useRef(setView);
  viewLatest.current = setView;

  useEffect(() => {
    let live = true;
    setInfo(null);
    invoke<Info>("share_probe", { path: file }).then(
      (i) => {
        if (!live) return;
        setInfo(i);
        setRange(clampRange(0, GIF_MAX_MS, i.durationMs, "start"));
      },
      (e) => live && setError(asError(e).message),
    );
    return () => {
      live = false;
    };
  }, [file]);

  useEffect(() => {
    const off = listen<ShareEvent>("rokk-share-job", (e) => {
      const next = reduceJob(jobRef.current, e.payload);
      if (next !== jobRef.current) viewLatest.current(next);
    });
    return () => {
      void off.then((f) => f());
      // Closing the panel cancels a file still being made.
      const j = jobRef.current;
      if (j.kind === "running" && j.job !== null)
        void invoke("share_cancel", { job: j.job });
    };
  }, []);

  const p = PLATFORMS[tab];
  const meta = info;
  const limit = sizeLimit(tab);
  const over = !!meta && limit !== null && meta.bytes > limit;
  // A smaller copy is offered only when the file is over the limit.
  const rate = over ? smallerRate(meta.durationMs, limit) : null;
  const running = job.kind === "running" ? job : null;

  const remember = (next: Partial<Remembered>) => {
    const r = { ...mem, ...next };
    setMem(r);
    writeRemembered(store, r);
  };
  // A saved browser or profile that is gone: the default browser, once.
  const forget = () => {
    setNote(NOT_FOUND);
    remember({ browser: "", profile: "" });
  };
  useEffect(() => {
    invoke<Browser[]>("list_browsers").then(setBrowsers, () => setBrowsers([]));
  }, []);
  const chromium = browsers?.find(
    (b) => b.id === mem.browser,
  )?.supports_profiles;
  useEffect(() => {
    setProfiles(null);
    if (chromium)
      invoke<Profile[]>("list_browser_profiles", {
        browserId: mem.browser,
      }).then(setProfiles, () => setProfiles([]));
  }, [mem.browser, chromium]);
  const { missing, where } = choice(
    mem.browser,
    mem.profile,
    browsers,
    chromium ? profiles : [],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the lists say the saved choice is gone
  useEffect(() => {
    if (missing) forget();
  }, [missing]);
  const edit = (k: CaptionKey, v: string) =>
    remember({ captions: { ...captions, [k]: v } });
  const onLink = () => {
    const r = checkLink(linkInput);
    if (!r.ok) {
      setLinkError(r.message);
      return;
    }
    setLinkError(null);
    setLinkInput(r.link);
    const next = { ...captions };
    for (const k of Object.keys(next) as CaptionKey[])
      next[k] = applyLink(next[k], r.link);
    remember({ link: r.link, captions: next });
  };
  const onCredit = (on: boolean) =>
    remember({
      credit: on,
      captions: {
        ...captions,
        x: setCredit(captions.x, on),
        linkedin: setCredit(captions.linkedin, on),
        youtube: setCredit(captions.youtube, on),
      },
    });
  // "Copied" replaces a button's label for 1.5 s.
  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };
  const copyText = (text: string, key: string) =>
    navigator.clipboard.writeText(text).then(
      () => flash(key),
      () => setNote("Could not copy."),
    );
  const fail = (e: unknown) => setNote(asError(e).message);

  const openCompose = async () => {
    if (!allowed("open", confirmed)) return;
    if (!p.compose.prefill && tab === "linkedin")
      await copyText(captions.linkedin, "caption");
    invoke<{ fallback: boolean }>("open_share_url", {
      url: composeUrl(tab, captions[tab]),
      browserId: mem.browser || null,
      profileDir: mem.profile || null,
    }).then((r) => {
      setOpened(tab);
      if (r.fallback) forget();
    }, fail);
  };
  const copyFile = () => {
    if (!allowed("copyFile", confirmed)) return;
    invoke("share_copy_file", { path: file }).then(() => flash("file"), fail);
  };
  const onDragDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (!allowed("drag", confirmed) || e.button !== 0) return;
    e.preventDefault();
    drag.current = { x: e.clientX, y: e.clientY, sent: false };
  };
  const onDragMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.sent || (e.buttons & 1) === 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    d.sent = true;
    invoke("share_drag", { path: file }).then(
      () => setNote("Drop the video into the post."),
      fail,
    );
  };
  /** Starts the one share job: a smaller copy or a GIF. */
  const start = (what: "smaller" | "gif", args: Record<string, number>) => {
    if (running) return;
    setView({ kind: "running", what, job: null, progress: 0 });
    invoke<number>(`share_${what}_start`, { path: file, ...args }).then(
      (id) => {
        const v = jobRef.current;
        if (v.kind === "running" && v.job === null) setView({ ...v, job: id });
      },
      (e) => setView({ kind: "error", what, ...asError(e) }),
    );
  };
  const savePoster = () => {
    setPoster("busy");
    invoke<Saved>("share_poster", { path: file, atMs: time * 1000 }).then(
      (s) => {
        setPoster(s);
      },
      (e) => {
        setPoster(null);
        fail(e);
      },
    );
  };
  const seek = (t: number) => {
    setTime(t);
    if (video.current) video.current.currentTime = t;
  };
  const mark = (which: "start" | "end") => {
    if (!meta) return;
    const ms = time * 1000;
    setRange(
      which === "start"
        ? clampRange(ms, range[1], meta.durationMs, "start")
        : clampRange(range[0], ms, meta.durationMs, "end"),
    );
  };

  const jobRow = (what: "smaller" | "gif") => {
    if (job.kind === "idle" || job.what !== what) return null;
    if (job.kind === "running")
      return (
        <div className="rk-share-row">
          <div
            className="rk-share-bar"
            role="progressbar"
            aria-label={what === "gif" ? "GIF" : "Smaller copy"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(job.progress * 100)}
          >
            <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          <Btn
            disabled={job.job === null}
            onClick={() => void invoke("share_cancel", { job: job.job })}
          >
            Cancel
          </Btn>
        </div>
      );
    if (job.kind === "done")
      return (
        <SavedRow
          path={job.output}
          text={
            what === "gif"
              ? `${job.width} px wide, ${job.fps} fps, ${formatBytes(job.size)}`
              : `${job.width} by ${job.height}, ${formatBytes(job.size)}`
          }
        />
      );
    return (
      <p
        className="rk-share-note"
        role={job.kind === "error" ? "alert" : "status"}
      >
        {job.kind === "error"
          ? `${job.message} (${job.code})`
          : "Cancelled. Nothing saved."}
      </p>
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="rk-share-dialog"
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => {
          const el = opener();
          if (el) {
            e.preventDefault();
            el.focus();
          }
        }}
      >
        <DialogTitle>Share</DialogTitle>
        <div className="rk-share-grid">
          <section className="rk-share-left" aria-label="Video">
            <video
              ref={video}
              className="rk-share-video"
              src={convertFileSrc(file)}
              preload="auto"
              muted
              playsInline
              aria-label="Poster preview"
              onLoadedData={(e) => {
                e.currentTarget.currentTime = time;
              }}
            />
            {meta ? (
              <>
                <input
                  type="range"
                  className="rk-share-scrub"
                  aria-label="Frame"
                  aria-valuetext={`${formatDuration(time * 1000)} of ${formatDuration(meta.durationMs)}`}
                  min={0}
                  max={meta.durationMs / 1000}
                  step={0.05}
                  value={time}
                  onChange={(e) => seek(Number(e.currentTarget.value))}
                />
                <p className="rk-share-note">
                  {meta.name}: {formatDuration(meta.durationMs)}, {meta.width}{" "}
                  by {meta.height}, {formatBytes(meta.bytes)},{" "}
                  {meta.codec || "unknown codec"}
                </p>
                <h3 className="rk-share-h">Save GIF for a README</h3>
                <div className="rk-share-row">
                  <Btn onClick={() => mark("start")}>Set start</Btn>
                  <Btn onClick={() => mark("end")}>Set end</Btn>
                  <span className="rk-share-note">
                    {formatDuration(range[0])} to {formatDuration(range[1])}
                  </span>
                </div>
                <p className="rk-share-note">
                  Up to 10 seconds, 960 px wide, 12 fps, under 10 MB.
                </p>
                <div className="rk-share-row">
                  <Btn
                    disabled={!!running}
                    onClick={() =>
                      start("gif", { startMs: range[0], endMs: range[1] })
                    }
                  >
                    Save GIF
                  </Btn>
                  <Btn disabled={poster === "busy"} onClick={savePoster}>
                    {poster === "busy" ? "Saving poster..." : "Save poster"}
                  </Btn>
                </div>
                {jobRow("gif")}
                {poster && poster !== "busy" ? (
                  <SavedRow
                    path={poster.output}
                    text={`${poster.width} by ${poster.height}, ${formatBytes(poster.size)}`}
                  />
                ) : null}
              </>
            ) : (
              <p className="rk-share-note" role={error ? "alert" : undefined}>
                {error ?? "Reading the video..."}
              </p>
            )}
          </section>

          <section className="rk-share-right" aria-label="Post">
            <Tabs
              value={tab}
              onValueChange={(v) => {
                remember({ tab: v as PlatformId });
                setOpened(null);
                setNote("");
              }}
            >
              <TabsList aria-label="Platform">
                {PLATFORM_IDS.map((id) => (
                  <TabsTrigger key={id} value={id}>
                    {PLATFORMS[id].name}
                  </TabsTrigger>
                ))}
              </TabsList>
              {PLATFORM_IDS.map((id) => {
                const pl = PLATFORMS[id];
                return (
                  <TabsContent key={id} value={id} className="rk-share-tab">
                    {meta ? (
                      <ul
                        className="rk-share-checks"
                        aria-label={`${pl.name} checks`}
                      >
                        {checksFor(pl, meta).map((c) => (
                          <li
                            key={c.key}
                            className="rk-share-check"
                            data-ok={c.ok}
                          >
                            {c.text}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {pl.title ? (
                      <label className="rk-share-field">
                        Title
                        <input
                          className="rk-share-input"
                          value={captions.youtubeTitle}
                          onChange={(e) =>
                            edit("youtubeTitle", e.currentTarget.value)
                          }
                        />
                        <Counter
                          n={charLength(captions.youtubeTitle)}
                          limit={pl.title.limit}
                          rule={pl.title.ruleText}
                        />
                      </label>
                    ) : null}
                    {pl.title ? (
                      <Btn
                        onClick={() =>
                          void copyText(captions.youtubeTitle, "title")
                        }
                      >
                        {copied === "title" ? "Copied" : "Copy title"}
                      </Btn>
                    ) : null}
                    <label
                      className="rk-share-field"
                      htmlFor={`rk-share-caption-${id}`}
                    >
                      {id === "youtube" ? "Description" : "Caption"}
                      <Textarea
                        id={`rk-share-caption-${id}`}
                        className="rk-share-caption"
                        value={captions[id]}
                        onChange={(e) => edit(id, e.currentTarget.value)}
                        rows={5}
                      />
                      <Counter
                        n={captionLength(id, captions[id])}
                        limit={pl.caption.limit}
                        rule={pl.caption.ruleText}
                      />
                    </label>
                  </TabsContent>
                );
              })}
            </Tabs>

            <label className="rk-share-confirm" htmlFor="rk-share-confirm">
              <Checkbox
                id="rk-share-confirm"
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(v === true)}
              />
              {CONFIRM_TEXT}
            </label>

            <PostButton
              id={tab}
              confirmed={confirmed}
              opened={opened === tab}
              where={where}
              onPost={() => void openCompose()}
            />
            {/* One row (2 by 2 when narrow): the four hand-off actions. */}
            <div className="rk-share-four">
              <Btn onClick={() => void copyText(captions[tab], "caption")}>
                {copied === "caption" ? "Copied" : "Copy caption"}
              </Btn>
              <Btn aria-disabled={!confirmed} onClick={copyFile}>
                {copied === "file" ? "Copied" : "Copy file"}
              </Btn>
              <Btn
                className="rk-share-btn rk-share-drag"
                aria-disabled={!confirmed}
                draggable={false}
                onPointerDown={onDragDown}
                onPointerMove={onDragMove}
                onPointerUp={() => {
                  drag.current = null;
                }}
              >
                Drag the video
              </Btn>
              <Btn onClick={() => void revealItemInDir(file)}>
                Show in Finder
              </Btn>
            </div>
            {over ? (
              <div className="rk-share-row">
                <Btn
                  disabled={!rate || !!running}
                  onClick={() => rate && start("smaller", { bitRate: rate })}
                >
                  Make a smaller copy
                </Btn>
                <span className="rk-share-note">
                  {rate
                    ? `1080p, about ${formatBytes(estimateBytes(rate, meta.durationMs))}`
                    : "Too long to fit under the limit."}
                </span>
              </div>
            ) : null}
            {jobRow("smaller")}
            {note ? (
              <p className="rk-share-note" role="status">
                {note}
              </p>
            ) : null}

            <details className="rk-share-settings">
              <summary>Share settings</summary>
              <label className="rk-share-field">
                Link to include
                <input
                  className="rk-share-input"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={linkInput}
                  aria-invalid={!!linkError}
                  aria-describedby={
                    linkError ? "rk-share-link-error" : undefined
                  }
                  onChange={(e) => setLinkInput(e.currentTarget.value)}
                  onBlur={onLink}
                  onKeyDown={(e) => e.key === "Enter" && onLink()}
                />
              </label>
              {linkError ? (
                <p
                  id="rk-share-link-error"
                  className="rk-share-note"
                  role="alert"
                >
                  {linkError}
                </p>
              ) : null}
              <label className="rk-share-field">
                Open links in
                <select
                  className="rk-share-input"
                  value={mem.browser}
                  onChange={(e) =>
                    remember({ browser: e.currentTarget.value, profile: "" })
                  }
                >
                  <option value="">Default browser</option>
                  {browsers?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              {chromium && profiles?.length ? (
                <label className="rk-share-field">
                  Profile
                  <select
                    className="rk-share-input"
                    value={mem.profile}
                    onChange={(e) =>
                      remember({ profile: e.currentTarget.value })
                    }
                  >
                    <option value="">Last used</option>
                    {profiles.map((p) => (
                      <option key={p.dir} value={p.dir}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="rk-share-confirm" htmlFor="rk-share-credit">
                <Switch
                  id="rk-share-credit"
                  checked={mem.credit}
                  onCheckedChange={onCredit}
                />
                Add "Recorded with Rokk" to captions
              </label>
            </details>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
