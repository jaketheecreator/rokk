// Magic phrases: a whole prompt that is exactly one of a few short phrases.
// Checked before the vagueness score and exempt from its cooldown.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Magic {
    ShipIt,
}

const SHIP_IT: &[&str] = &[
    "ship it",
    "ship it now",
    "ship this",
    "ship",
    "lets ship it",
    "let's ship it",
    "lets ship",
    "ready to ship",
];

/// The checklist Claude gets for "ship it".
pub const SHIP_IT_CONTEXT: &str = "Rokk ship-it checklist. The user wants to ship. Do NOT commit, push, deploy or publish anything yet. Work in this order and keep the whole reply under 25 lines. 1. What would ship: run git status and git diff --stat (read-only) and list the changed files in plain language with a one-line summary of the work; if this is not a git repository, say so and stop. 2. Does it work: run the project's own checks that exist in its scripts or config (type check, lint, tests, build), one at a time, without installing anything, and report each as passed, failed or not found; do not fix failures now. 3. Secrets: check that .env files are git-ignored and not tracked, and search only the changed files for API-key-shaped text, private keys and hardcoded passwords; report file names and line numbers only and never print a secret value. 4. Loose ends: in the added lines of the diff, look for debug logging, debugger statements, TODO or FIXME, skipped or focused tests, any single file over 5 MB, and build output folders. 5. Verdict: say Go if the checks passed and nothing risky was found, otherwise say Wait with the one or two things to fix first. Then list what you could not check (for example whether it looks right on screen) and ask: Want me to commit and push? Do nothing further until the user says yes. If they say yes, commit with a clear message, push only the current branch, never force, and never deploy.";

pub const SHIP_IT_MESSAGE: &str = "Rokk: running the ship-it checklist.";

/// Trimmed, lowercased, single-spaced, curly apostrophes made straight,
/// trailing `.`, `!` and `?` removed.
fn normalize(prompt: &str) -> String {
    let lower = prompt.to_lowercase().replace(['\u{2019}', '\u{2018}'], "'");
    let joined = lower.split_whitespace().collect::<Vec<_>>().join(" ");
    joined.trim_end_matches(['.', '!', '?']).trim_end().to_string()
}

pub fn magic(prompt: &str) -> Option<Magic> {
    let p = normalize(prompt);
    SHIP_IT.contains(&p.as_str()).then_some(Magic::ShipIt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table() {
        let yes = [
            "ship it",
            "ship it now",
            "ship this",
            "ship",
            "lets ship it",
            "let's ship it",
            "lets ship",
            "ready to ship",
            "Ship it",
            "SHIP IT!",
            "ship it.",
            "Ship it?!",
            "  ship   it  ",
            "ship\tit\n",
            "Let\u{2019}s ship it!",
            "Ready to ship...",
        ];
        for p in yes {
            assert_eq!(magic(p), Some(Magic::ShipIt), "{p:?}");
        }
        let no = [
            "",
            "   ",
            "!",
            "ship it to production tomorrow with vercel",
            "how do I ship a node app",
            "shipping notes",
            "shipit",
            "please ship it",
            "ship it please",
            "ship it, then fix the header",
            "don't ship it",
            "/ship it",
            "ship-it",
            "shïp it",
            "ship it 🚀",
            "ready to ship?? no",
        ];
        for p in no {
            assert_eq!(magic(p), None, "{p:?}");
        }
        assert!(yes.len() + no.len() >= 25);
    }

    #[test]
    fn ship_it_is_skipped_not_vague() {
        use super::super::score::{score, Config, Sensitivity, Verdict};
        for sensitivity in [Sensitivity::Low, Sensitivity::Medium] {
            let s = score("ship it", Config { sensitivity });
            assert_eq!(s.verdict, Verdict::Skipped);
        }
        // Longer prompts are judged as usual.
        let s = score("ship it to production tomorrow with vercel", Config::default());
        assert_ne!(s.verdict, Verdict::Skipped);
    }

    #[test]
    fn checklist_text_has_the_rules() {
        for step in ["1. What would ship", "2. Does it work", "3. Secrets", "4. Loose ends", "5. Verdict"] {
            assert!(SHIP_IT_CONTEXT.contains(step), "{step}");
        }
        assert!(SHIP_IT_CONTEXT.contains("Do NOT commit, push, deploy or publish"));
        assert!(SHIP_IT_CONTEXT.contains("never print a secret value"));
        assert!(SHIP_IT_CONTEXT.len() < 2000, "{}", SHIP_IT_CONTEXT.len());
        assert!(!SHIP_IT_CONTEXT.contains('\u{2014}'));
    }
}
