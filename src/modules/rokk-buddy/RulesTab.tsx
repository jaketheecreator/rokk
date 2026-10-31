import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useId } from "react";
import { defaultRules, type HouseRules, type PackageManager, RULES } from "./lib/rules";
import { clearSavedText } from "./lib/storage";
import { type Actions, BUTTON, FIELD, HINT } from "./parts";

type Props = {
  rules: HouseRules;
  onChange: (rules: HouseRules) => void;
  packageManager: PackageManager | null;
  actions: Actions;
};

export function RulesTab({ rules, onChange, packageManager, actions }: Props) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-1">
        {RULES.map((r) => (
          <li key={r.id} className="flex min-h-11 items-center gap-3">
            <Switch
              id={`${id}-${r.id}`}
              checked={rules.enabled[r.id]}
              onCheckedChange={(on) => onChange({ ...rules, enabled: { ...rules.enabled, [r.id]: on } })}
            />
            <Label htmlFor={`${id}-${r.id}`} className="flex flex-col items-start gap-0.5">
              <span className={FIELD}>{r.label}</span>
              <span className={HINT}>
                {r.id === "packageManager" && packageManager ? `${r.description} Found: ${packageManager}.` : r.description}
              </span>
            </Label>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-extra`} className={FIELD}>Extra rules (one per line)</Label>
        <Textarea
          id={`${id}-extra`}
          value={rules.extra}
          onChange={(e) => onChange({ ...rules, extra: e.target.value })}
          className="min-h-24 text-[13px]"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            onChange(defaultRules());
            actions.announce("Rules reset to the defaults.");
          }}
        >
          Reset to defaults
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            clearSavedText();
            onChange(defaultRules());
            actions.announce("Saved rules, drafts and recent prompts were cleared.");
          }}
        >
          Clear saved text
        </button>
      </div>
    </div>
  );
}
