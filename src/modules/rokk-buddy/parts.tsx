import { cn } from "@/lib/utils";
import type { InsertDecision } from "./lib/insert";

export type Actions = {
  copy: (text: string) => void;
  paste: (text: string) => void;
  insert: InsertDecision;
  announce: (message: string) => void;
};

export const FIELD = "text-[13px] font-medium text-[var(--rk-text)]";
export const HINT = "text-[12px] text-[var(--rk-text-2)]";
export const BUTTON =
  "inline-flex h-9 items-center justify-center rounded-[var(--rk-radius-sm)] bg-[var(--rk-field)] px-3.5 text-[13px] font-medium text-[var(--rk-text)] outline-none transition-colors duration-150 ease-[ease] hover:bg-[var(--rk-active)] focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <fieldset className="flex min-w-0 gap-1 rounded-[11px] bg-[var(--rk-field)] p-1">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={cn(
            "h-8 flex-1 rounded-[8px] px-3 text-[12.5px] outline-none transition-colors duration-150 ease-[ease] focus-visible:ring-2 focus-visible:ring-ring/50",
            o.id === value
              ? "bg-[var(--rk-active)] font-semibold text-[var(--rk-text)]"
              : "font-medium text-[var(--rk-text-2)] hover:text-[var(--rk-text)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

export function PasteButton({ actions, text }: { actions: Actions; text: string }) {
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className={BUTTON}
        disabled={!actions.insert.ok || !text.trim()}
        onClick={() => actions.paste(text)}
      >
        Paste into Claude
      </button>
      {actions.insert.ok ? null : <span className={HINT}>{actions.insert.reason}</span>}
    </span>
  );
}
