// The vague-prompt detector. Pure and synchronous: the prompt is read in
// memory only and never logged, stored or sent anywhere.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sensitivity {
    #[default]
    Low,
    Medium,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Config {
    pub sensitivity: Sensitivity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Specific,
    Vague,
    Skipped,
}

#[derive(Clone, Debug, Serialize)]
pub struct Score {
    pub verdict: Verdict,
    pub reasons: Vec<String>,
    pub signals: usize,
    pub words: usize,
}

/// Longer prompts carry their own context.
const MAX_CHARS: usize = 400;

/// Plain-language phrases that, with little else, leave Claude guessing.
/// Matched case-insensitively on word boundaries.
const VAGUE_MARKERS: &[&str] = &[
    "fix it",
    "fix this",
    "fix that",
    "fix everything",
    "fix the bug",
    "fix the issue",
    "make it better",
    "make it nicer",
    "make it look better",
    "make it look good",
    "make it work",
    "make it pop",
    "improve",
    "improve it",
    "clean up",
    "cleanup",
    "tidy",
    "tidy up",
    "polish",
    "something",
    "anything",
    "it doesn't work",
    "doesn't work",
    "does not work",
    "not working",
    "isn't working",
    "still broken",
    "broken",
    "doesn't look right",
    "looks wrong",
    "looks off",
    "update it",
    "change it",
    "redo it",
    "redo",
    "same as before",
    "like before",
    "like the other one",
    "do the thing",
    "you know what i mean",
];

/// Words that make up acknowledgements and answers ("yes", "go ahead",
/// "the first one", "option b"). A prompt made only of these is skipped.
const ACK_WORDS: &[&str] = &[
    "yes", "y", "yeah", "yep", "yup", "sure", "ok", "okay", "k", "kk", "fine", "go", "ahead",
    "continue", "proceed", "thanks", "thank", "you", "thx", "ty", "please", "do", "it", "that",
    "this", "sounds", "good", "great", "perfect", "cool", "nice", "lgtm", "done", "next",
    "approved", "agreed", "correct", "right", "exactly", "no", "nope", "stop", "wait", "cancel",
    "option", "the", "one", "first", "second", "third", "fourth", "last", "other", "both",
    "neither", "all", "none", "of", "them", "and", "or", "that's", "go-ahead", "looks", "ship",
];

const OUTCOME_PHRASES: &[&str] = &[
    "should",
    "so that",
    "instead of",
    "rather than",
    "expected",
    "expect",
    "i want it to",
];

const FILE_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "mdx", "css", "scss", "sass", "less",
    "html", "htm", "rs", "py", "go", "rb", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs",
    "php", "sql", "yml", "yaml", "toml", "lock", "sh", "zsh", "bash", "fish", "txt", "env", "vue",
    "svelte", "astro", "xml", "svg", "png", "jpg", "jpeg", "gif", "webp", "ico", "csv", "ini",
    "cfg", "conf", "gradle", "dart", "lua", "ex", "exs", "prisma", "graphql", "proto", "dockerfile",
];

const NOT_PATHS: &[&str] = &["and/or", "either/or", "w/", "w/o", "n/a", "i/o", "on/off", "yes/no"];

const LOG_LEVELS: &[&str] = &["ERROR", "WARN", "WARNING", "INFO", "DEBUG", "TRACE", "FATAL"];

/// Kinds of specificity; each kind counts once.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Signal {
    Path,
    Identifier,
    Url,
    Error,
    Quantity,
    Quote,
    Outcome,
}

impl Signal {
    fn reason(self) -> &'static str {
        match self {
            Signal::Path => "Mentions a file or folder",
            Signal::Identifier => "Names something in the code",
            Signal::Url => "Includes a link",
            Signal::Error => "Quotes an error or error code",
            Signal::Quantity => "Gives a number or size",
            Signal::Quote => "Quotes exact text",
            Signal::Outcome => "Says what the result should be",
        }
    }
}

pub fn score(prompt: &str, config: Config) -> Score {
    let trimmed = prompt.trim();
    let words = trimmed.split_whitespace().count();
    if let Some(reason) = skip_reason(trimmed) {
        return Score {
            verdict: Verdict::Skipped,
            reasons: vec![reason.to_string()],
            signals: 0,
            words,
        };
    }

    let found = signals(trimmed);
    let signals = found.len();
    let lower = normalize(trimmed);
    let marker = VAGUE_MARKERS
        .iter()
        .copied()
        .find(|m| contains_phrase(&lower, m));

    let vague = (signals == 0 && words < 25)
        || (marker.is_some() && signals <= 1 && words < 40)
        || (config.sensitivity == Sensitivity::Medium && signals <= 1 && words < 15);

    let mut reasons = Vec::new();
    if vague {
        if let Some(m) = marker {
            reasons.push(format!("Uses a vague phrase: \"{m}\""));
        }
        if signals == 0 {
            reasons.push("No file, name, error or expected result is mentioned".to_string());
        } else {
            reasons.push("Only one concrete detail is given".to_string());
        }
        if words < 15 {
            reasons.push(format!("Very short ({words} words)"));
        }
    } else {
        reasons.extend(found.iter().map(|s| s.reason().to_string()));
        if reasons.is_empty() {
            reasons.push(format!("Long enough to explain itself ({words} words)"));
        }
    }

    Score {
        verdict: if vague { Verdict::Vague } else { Verdict::Specific },
        reasons,
        signals,
        words,
    }
}

fn skip_reason(p: &str) -> Option<&'static str> {
    if p.is_empty() {
        return Some("Empty prompt");
    }
    if super::magic::magic(p).is_some() {
        return Some("A magic phrase (ship it), handled by the Ship it checklist");
    }
    match p.chars().next() {
        Some('/') => return Some("Slash command"),
        Some('!') => return Some("Shell command"),
        Some('#') => return Some("Memory note"),
        _ => {}
    }
    if p.chars().count() > MAX_CHARS {
        return Some("Long prompt: it carries its own context");
    }
    if p.contains("```") || p.contains("<pasted_content") {
        return Some("Contains code or pasted text");
    }
    if looks_like_log(p) {
        return Some("Contains a log or stack trace");
    }
    if !mostly_ascii_letters(p) {
        return Some("Not mostly English text, so it is not judged");
    }
    if is_ack(p) {
        return Some("An answer or acknowledgement");
    }
    None
}

fn looks_like_log(p: &str) -> bool {
    const TRACE: &[&str] = &[
        "Traceback (most recent call last)",
        "panicked at",
        "Exception in thread",
        "\n    at ",
        "\n\tat ",
    ];
    if TRACE.iter().any(|t| p.contains(t)) {
        return true;
    }
    let log_lines = p
        .lines()
        .filter(|l| {
            let l = l.trim_start();
            let ts = l.len() >= 5
                && l.as_bytes()[..2].iter().all(u8::is_ascii_digit)
                && l.as_bytes()[2] == b':';
            ts || LOG_LEVELS.iter().any(|lv| {
                l.starts_with(lv)
                    || l.starts_with(&format!("[{lv}]"))
                    || l.contains(&format!(" {lv} "))
            })
        })
        .count();
    log_lines >= 3
}

/// True when at least 80% of the letters are ASCII. Text with no letters
/// at all ("2", "?") is left to the acknowledgement rule.
fn mostly_ascii_letters(p: &str) -> bool {
    let letters = p.chars().filter(|c| c.is_alphabetic()).count();
    if letters == 0 {
        return true;
    }
    let ascii = p.chars().filter(char::is_ascii_alphabetic).count();
    ascii * 5 >= letters * 4
}

fn is_ack(p: &str) -> bool {
    let lower = normalize(p);
    let tokens: Vec<&str> = lower
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | '.' | '!' | '?' | ';' | ':' | ')' | '('))
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() {
        // Only punctuation, for example "?" or "...".
        return true;
    }
    tokens.len() <= 6
        && tokens.iter().all(|t| {
            ACK_WORDS.contains(t)
                || t.chars().all(|c| c.is_ascii_digit())
                || (t.len() == 1 && t.chars().all(|c| c.is_ascii_lowercase()))
        })
}

fn normalize(p: &str) -> String {
    p.to_lowercase()
        .replace(['\u{2019}', '\u{2018}'], "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Phrase match on word boundaries in already-normalized text.
fn contains_phrase(hay: &str, phrase: &str) -> bool {
    let bytes = hay.as_bytes();
    let mut from = 0;
    while let Some(pos) = hay[from..].find(phrase) {
        let start = from + pos;
        let end = start + phrase.len();
        let before = start == 0 || !is_word_byte(bytes[start - 1]);
        let after = end == hay.len() || !is_word_byte(bytes[end]);
        if before && after {
            return true;
        }
        from = start + 1;
        while !hay.is_char_boundary(from) {
            from += 1;
        }
    }
    false
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn signals(p: &str) -> Vec<Signal> {
    let mut out: Vec<Signal> = Vec::new();
    let mut add = |s: Signal| {
        if !out.contains(&s) {
            out.push(s);
        }
    };

    let tokens: Vec<&str> = p.split_whitespace().collect();
    for (i, raw) in tokens.iter().enumerate() {
        let t = raw.trim_matches(|c: char| matches!(c, ',' | ';' | ':' | '(' | ')' | '?' | '!' | '"' | '\''));
        let t = t.trim_end_matches('.');
        if t.is_empty() {
            continue;
        }
        if is_url(t) {
            add(Signal::Url);
            continue;
        }
        if is_path(t) {
            add(Signal::Path);
        }
        if is_identifier(t) {
            add(Signal::Identifier);
        }
        if is_error_code(t) {
            add(Signal::Error);
        }
        if is_quantity(t, tokens.get(i + 1).copied()) {
            add(Signal::Quantity);
        }
    }
    if has_backticks(p) {
        add(Signal::Identifier);
    }
    if has_error_text(p) {
        add(Signal::Error);
    }
    if has_quote(p) {
        add(Signal::Quote);
    }
    let lower = normalize(p);
    let when_then = contains_phrase(&lower, "when") && contains_phrase(&lower, "then");
    if when_then || OUTCOME_PHRASES.iter().any(|ph| contains_phrase(&lower, ph)) {
        add(Signal::Outcome);
    }
    out
}

fn is_url(t: &str) -> bool {
    let l = t.to_ascii_lowercase();
    l.starts_with("http://")
        || l.starts_with("https://")
        || l.starts_with("www.")
        || l.starts_with("localhost:")
}

fn is_path(t: &str) -> bool {
    let l = t.to_ascii_lowercase();
    if NOT_PATHS.contains(&l.as_str()) {
        return false;
    }
    if (t.contains('/') || t.contains('\\')) && t.chars().any(|c| c.is_ascii_alphanumeric()) {
        return true;
    }
    // Dotfiles such as .env or .gitignore.
    if let Some(rest) = l.strip_prefix('.') {
        if rest.len() >= 2 && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return true;
        }
    }
    match l.rsplit_once('.') {
        Some((stem, ext)) => !stem.is_empty() && FILE_EXTENSIONS.contains(&ext),
        None => l == "dockerfile" || l == "makefile",
    }
}

fn is_identifier(t: &str) -> bool {
    let core = t.trim_end_matches("()");
    let call = t.ends_with("()") && core.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.');
    if call && !core.is_empty() {
        return true;
    }
    let chars: Vec<char> = core.chars().collect();
    let word_like = chars.iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '/' | '-'));
    if !word_like {
        return false;
    }
    // snake_case: an underscore between two alphanumerics.
    let snake = chars.windows(3).any(|w| {
        w[1] == '_' && w[0].is_ascii_alphanumeric() && w[2].is_ascii_alphanumeric()
    });
    // camelCase or PascalCase with an inner capital: lower then upper.
    let camel = chars
        .windows(2)
        .any(|w| w[0].is_ascii_lowercase() && w[1].is_ascii_uppercase());
    // A hex colour such as #1a2b3c.
    let hex = t.starts_with('#')
        && matches!(t.len(), 4 | 7)
        && t[1..].chars().all(|c| c.is_ascii_hexdigit());
    snake || camel || hex
}

fn is_error_code(t: &str) -> bool {
    let b = t.as_bytes();
    // TS2322, E0308, ERR42
    let letters = b.iter().take_while(|c| c.is_ascii_uppercase()).count();
    let digits = b.len() - letters;
    let code = (1..=5).contains(&letters)
        && (2..=5).contains(&digits)
        && b[letters..].iter().all(u8::is_ascii_digit);
    // ENOENT, EACCES
    let errno = b.len() >= 5 && b[0] == b'E' && b.iter().all(u8::is_ascii_uppercase);
    // HTTP 4xx and 5xx
    let http = b.len() == 3
        && b.iter().all(u8::is_ascii_digit)
        && matches!(b[0], b'4' | b'5');
    // TypeError, SyntaxError, NullPointerException
    let named = t.len() > 5
        && t.chars().next().is_some_and(|c| c.is_ascii_uppercase())
        && (t.ends_with("Error") || t.ends_with("Exception"));
    code || errno || http || named
}

fn has_error_text(p: &str) -> bool {
    let l = p.to_ascii_lowercase();
    ["error:", "exception:", "failed:", "fatal:", "cannot find", "is not defined", "undefined is not"]
        .iter()
        .any(|m| l.contains(m))
}

fn is_quantity(t: &str, next: Option<&str>) -> bool {
    let digits = t.chars().take_while(|c| c.is_ascii_digit() || *c == '.').count();
    if digits == 0 || !t.starts_with(|c: char| c.is_ascii_digit()) {
        return false;
    }
    let rest = &t[digits..];
    if !rest.is_empty() {
        // 16px, 50%, 2x, 1.5rem, 300ms
        return rest == "%" || rest.chars().all(|c| c.is_ascii_alphabetic());
    }
    // A bare number followed by a word: "2 lines", "3 items".
    next.is_some_and(|n| {
        let n = n.trim_end_matches(|c: char| !c.is_ascii_alphanumeric());
        n.len() >= 2 && n.chars().all(|c| c.is_ascii_alphabetic())
    })
}

fn has_backticks(p: &str) -> bool {
    let mut parts = p.split('`');
    parts.next();
    parts.next().is_some_and(|inner| !inner.trim().is_empty()) && p.matches('`').count() >= 2
}

/// A quoted string of at least two characters. Apostrophes inside words
/// ("doesn't") are not quotes: a single quote opens only after a space or
/// at the start, and closes only before a space, punctuation or the end.
fn has_quote(p: &str) -> bool {
    let chars: Vec<char> = p.chars().collect();
    for (open, close) in [('"', '"'), ('\u{201C}', '\u{201D}'), ('\'', '\''), ('\u{2018}', '\u{2019}')] {
        let mut i = 0;
        while i < chars.len() {
            if chars[i] == open {
                let opens = open == '"' || i == 0 || chars[i - 1].is_whitespace();
                if opens {
                    if let Some(len) = chars[i + 1..].iter().position(|&c| c == close) {
                        let j = i + 1 + len;
                        let inner: String = chars[i + 1..j].iter().collect();
                        let closes = open == '"'
                            || j + 1 == chars.len()
                            || !chars[j + 1].is_alphanumeric();
                        if closes && inner.trim().chars().count() >= 2 {
                            return true;
                        }
                    }
                }
            }
            i += 1;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOW: Config = Config {
        sensitivity: Sensitivity::Low,
    };
    const MEDIUM: Config = Config {
        sensitivity: Sensitivity::Medium,
    };

    /// n plain words with no signal, no marker and no acknowledgement.
    fn filler(n: usize) -> String {
        const W: [&str; 5] = ["add", "the", "blue", "button", "here"];
        (0..n).map(|i| W[i % W.len()]).collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn table() {
        use Verdict::*;
        let long = format!("please look at this {}", "word ".repeat(90));
        let w24 = filler(24);
        let w25 = filler(25);
        // "fix it" + "src/app" (one signal) + filler, to exactly 39 and 40 words.
        let m39 = format!("fix it in src/app {}", filler(35));
        let m40 = format!("fix it in src/app {}", filler(36));
        let w14 = format!("add the toggle in src/app {}", filler(9));
        let cases: Vec<(&str, Config, Verdict)> = vec![
            // Skip rules
            ("", LOW, Skipped),
            ("   \n ", LOW, Skipped),
            ("/review", LOW, Skipped),
            ("!ls -la", LOW, Skipped),
            ("# always use pnpm", LOW, Skipped),
            ("yes", LOW, Skipped),
            ("No.", LOW, Skipped),
            ("ok go ahead", LOW, Skipped),
            ("Okay, continue", LOW, Skipped),
            ("thanks!", LOW, Skipped),
            ("do it", LOW, Skipped),
            ("a", LOW, Skipped),
            ("2", LOW, Skipped),
            ("the first one", LOW, Skipped),
            ("option b", MEDIUM, Skipped),
            ("fix it\n```\nlet x = 1;\n```", LOW, Skipped),
            ("fix it\n<pasted_content id=\"1\">\nlog\n</pasted_content id=\"1\">", LOW, Skipped),
            ("fix it\nTraceback (most recent call last):\n  File x", LOW, Skipped),
            ("fix it\nERROR boom\nERROR bang\nERROR again", LOW, Skipped),
            (long.as_str(), LOW, Skipped),
            ("修复它", LOW, Skipped),
            ("исправь это пожалуйста", LOW, Skipped),
            // Vague markers
            ("fix it", LOW, Vague),
            ("make it better", LOW, Vague),
            ("Make it nicer please", LOW, Vague),
            ("improve the page", LOW, Vague),
            ("clean up the code", LOW, Vague),
            ("it doesn't work", LOW, Vague),
            ("it\u{2019}s not working", LOW, Vague),
            ("the header is broken", LOW, Vague),
            ("redo it like the other one", LOW, Vague),
            ("add something to README.md", LOW, Vague),
            // Each specificity signal
            ("fix the crash in src/settings/GeneralSection.tsx", LOW, Specific),
            ("rename `loadUser` to fetch", LOW, Specific),
            ("call handleClick on submit", LOW, Specific),
            ("rename user_id everywhere", LOW, Specific),
            ("match https://example.com", LOW, Specific),
            ("TS2322 on build", LOW, Specific),
            ("getting ENOENT", LOW, Specific),
            ("set padding to 16px", LOW, Specific),
            ("show 3 items", LOW, Specific),
            ("change the title to \"Welcome back\"", LOW, Specific),
            ("the button should open the dialog", LOW, Specific),
            ("when I click save then close it", LOW, Specific),
            // Apostrophes are not quotes
            ("it doesn't look right", LOW, Vague),
            // Boundaries
            (w24.as_str(), LOW, Vague),
            (w25.as_str(), LOW, Specific),
            (m39.as_str(), LOW, Vague),
            (m40.as_str(), LOW, Specific),
            // Sensitivity
            (w14.as_str(), LOW, Specific),
            (w14.as_str(), MEDIUM, Vague),
            ("In src/settings/GeneralSection.tsx, add a toggle for the greeting", MEDIUM, Specific),
            ("In src/settings/GeneralSection.tsx, add a toggle for the greeting", LOW, Specific),
        ];
        assert!(cases.len() >= 30);
        for (prompt, cfg, want) in cases {
            let got = score(prompt, cfg);
            assert_eq!(got.verdict, want, "{prompt:?}: {:?}", got.reasons);
            assert!(!got.reasons.is_empty(), "{prompt:?} has no reasons");
        }
    }

    #[test]
    fn boundary_inputs_have_the_word_counts_the_rules_use() {
        assert_eq!(score(&filler(24), LOW).words, 24);
        assert_eq!(score(&format!("fix it in src/app {}", filler(36)), LOW).words, 40);
        assert_eq!(score(&format!("fix it in src/app {}", filler(36)), LOW).signals, 1);
    }

    #[test]
    fn reasons_are_plain_language() {
        let s = score("fix it", LOW);
        assert!(s.reasons.iter().any(|r| r.contains("\"fix it\"")));
        let s = score("set padding to 16px in App.tsx", LOW);
        assert!(s.reasons.contains(&"Gives a number or size".to_string()));
        assert!(s.reasons.contains(&"Mentions a file or folder".to_string()));
    }

    #[test]
    fn exactly_400_chars_is_scored_and_401_is_skipped() {
        let base = "fix it ";
        let p400 = format!("{base}{}", "a".repeat(400 - base.len()));
        assert_ne!(score(&p400, LOW).verdict, Verdict::Skipped);
        let p401 = format!("{p400}a");
        assert_eq!(score(&p401, LOW).verdict, Verdict::Skipped);
    }
}
