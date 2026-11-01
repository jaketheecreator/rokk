// Adds and removes the guard's one hook entry in ~/.claude/settings.json as
// a text splice, so every other byte of the file (key order, spacing, other
// people's hooks) stays exactly as it was. Each result is re-parsed and
// compared with the expected value before anything is written.

use serde_json::{json, Value};

/// Unique substring that identifies our hook command and nothing else.
pub const MARKER: &str = "/.rokk/hooks/prompt-guard";
const EVENT: &str = "UserPromptSubmit";

pub fn hook_command() -> String {
    r#"[ -n "$TERAX_TERMINAL" ] && [ -x "$HOME/.rokk/hooks/prompt-guard" ] && "$HOME/.rokk/hooks/prompt-guard"; true"#
        .to_string()
}

pub fn hook_group() -> Value {
    json!({ "hooks": [ { "type": "command", "command": hook_command(), "timeout": 2 } ] })
}

fn is_ours(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hs| {
            hs.iter().any(|h| {
                h.get("command")
                    .and_then(Value::as_str)
                    .is_some_and(|c| c.contains(MARKER))
            })
        })
}

fn parse(text: &str) -> Result<Option<Value>, String> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    let v: Value = serde_json::from_str(text)
        .map_err(|e| format!("~/.claude/settings.json is not valid JSON ({e}); nothing was changed"))?;
    if !v.is_object() {
        return Err("~/.claude/settings.json is not a JSON object; nothing was changed".into());
    }
    Ok(Some(v))
}

/// True when the parsed settings hold our entry.
pub fn has_entry(text: &str) -> Result<bool, String> {
    Ok(parse(text)?.is_some_and(|v| {
        v.get("hooks")
            .and_then(|h| h.get(EVENT))
            .and_then(Value::as_array)
            .is_some_and(|a| a.iter().any(is_ours))
    }))
}

/// The file with our entry present exactly once, in its current form.
pub fn add(text: &str) -> Result<String, String> {
    let Some(old) = parse(text)? else {
        let fresh = json!({ "hooks": { EVENT: [hook_group()] } });
        return Ok(serde_json::to_string_pretty(&fresh).map_err(|e| e.to_string())? + "\n");
    };
    let groups = old.get("hooks").and_then(|h| h.get(EVENT)).and_then(Value::as_array);
    let ours: Vec<&Value> = groups.map(|a| a.iter().filter(|g| is_ours(g)).collect()).unwrap_or_default();
    if ours.len() == 1 && *ours[0] == hook_group() {
        return Ok(text.to_string());
    }
    let base = if ours.is_empty() { text.to_string() } else { remove(text)? };
    let out = splice_add(&base)?;

    let mut expected = parse(&base)?.unwrap_or_else(|| json!({}));
    let obj = expected.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    hooks
        .as_object_mut()
        .ok_or("\"hooks\" in settings.json is not an object; nothing was changed")?
        .entry(EVENT)
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or("\"hooks.UserPromptSubmit\" is not a list; nothing was changed")?
        .push(hook_group());
    verify(&out, &expected)?;
    Ok(out)
}

/// The file without any of our entries. Empty containers that only held
/// our entry are dropped too.
pub fn remove(text: &str) -> Result<String, String> {
    let Some(old) = parse(text)? else {
        return Ok(text.to_string());
    };
    let mut out = text.to_string();
    while let Some(next) = splice_remove_one(&out)? {
        out = next;
    }

    let mut expected = old;
    if let Some(hooks) = expected.get_mut("hooks").and_then(Value::as_object_mut) {
        let mut drop_event = false;
        if let Some(arr) = hooks.get_mut(EVENT).and_then(Value::as_array_mut) {
            let before = arr.len();
            arr.retain(|g| !is_ours(g));
            drop_event = arr.is_empty() && before > 0;
        }
        if drop_event {
            hooks.remove(EVENT);
            if hooks.is_empty() {
                expected.as_object_mut().unwrap().remove("hooks");
            }
        }
    }
    verify(&out, &expected)?;
    Ok(out)
}

fn verify(out: &str, expected: &Value) -> Result<(), String> {
    match serde_json::from_str::<Value>(out) {
        Ok(v) if v == *expected => Ok(()),
        _ => Err("could not edit settings.json safely; nothing was changed".into()),
    }
}

// --- A minimal scanner over valid JSON (already checked by serde_json). ---

struct Member {
    key: String,
    start: usize,
    value_start: usize,
    value_end: usize,
}

struct Container {
    open: usize,
    close: usize,
}

fn ws(s: &[u8], mut i: usize) -> usize {
    while i < s.len() && matches!(s[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    i
}

fn bad() -> String {
    "unexpected settings.json layout; nothing was changed".to_string()
}

fn string_end(s: &[u8], i: usize) -> Result<usize, String> {
    let mut j = i + 1;
    while j < s.len() {
        match s[j] {
            b'\\' => j += 2,
            b'"' => return Ok(j + 1),
            _ => j += 1,
        }
    }
    Err(bad())
}

fn value_end(s: &[u8], i: usize) -> Result<usize, String> {
    match s.get(i) {
        Some(b'"') => string_end(s, i),
        Some(b'{') | Some(b'[') => {
            let mut depth = 0usize;
            let mut j = i;
            while j < s.len() {
                match s[j] {
                    b'"' => {
                        j = string_end(s, j)?;
                        continue;
                    }
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => {
                        depth -= 1;
                        if depth == 0 {
                            return Ok(j + 1);
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
            Err(bad())
        }
        Some(_) => {
            let mut j = i;
            while j < s.len() && !matches!(s[j], b',' | b'}' | b']' | b' ' | b'\t' | b'\n' | b'\r') {
                j += 1;
            }
            Ok(j)
        }
        None => Err(bad()),
    }
}

fn members(s: &[u8], open: usize) -> Result<(Vec<Member>, Container), String> {
    let mut out = Vec::new();
    let mut i = ws(s, open + 1);
    if s.get(i) == Some(&b'}') {
        return Ok((out, Container { open, close: i }));
    }
    loop {
        let start = i;
        let key_end = string_end(s, i)?;
        let key = serde_json::from_slice::<String>(&s[i..key_end]).map_err(|_| bad())?;
        i = ws(s, key_end);
        if s.get(i) != Some(&b':') {
            return Err(bad());
        }
        let value_start = ws(s, i + 1);
        let value_end = value_end(s, value_start)?;
        out.push(Member { key, start, value_start, value_end });
        i = ws(s, value_end);
        match s.get(i) {
            Some(b',') => i = ws(s, i + 1),
            Some(b'}') => return Ok((out, Container { open, close: i })),
            _ => return Err(bad()),
        }
    }
}

fn elements(s: &[u8], open: usize) -> Result<(Vec<(usize, usize)>, Container), String> {
    let mut out = Vec::new();
    let mut i = ws(s, open + 1);
    if s.get(i) == Some(&b']') {
        return Ok((out, Container { open, close: i }));
    }
    loop {
        let end = value_end(s, i)?;
        out.push((i, end));
        i = ws(s, end);
        match s.get(i) {
            Some(b',') => i = ws(s, i + 1),
            Some(b']') => return Ok((out, Container { open, close: i })),
            _ => return Err(bad()),
        }
    }
}

/// Last member with this key, matching serde_json's handling of duplicates.
fn find<'a>(ms: &'a [Member], key: &str) -> Option<&'a Member> {
    ms.iter().rev().find(|m| m.key == key)
}

fn root(s: &[u8]) -> Result<usize, String> {
    let i = ws(s, 0);
    if s.get(i) == Some(&b'{') {
        Ok(i)
    } else {
        Err(bad())
    }
}

/// Leading whitespace of the line holding byte `at`.
fn line_indent(text: &str, at: usize) -> String {
    let line_start = text[..at].rfind('\n').map_or(0, |n| n + 1);
    text[line_start..]
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect()
}

/// The file's indent unit, guessed from the first indented line.
fn indent_unit(text: &str) -> Option<String> {
    text.lines()
        .skip(1)
        .map(|l| l.chars().take_while(|c| *c == ' ' || *c == '\t').collect::<String>())
        .find(|w| !w.is_empty())
}

/// `value` rendered for insertion at `indent`, in the file's style.
fn render(value: &Value, unit: Option<&str>, indent: &str) -> String {
    let Some(unit) = unit else {
        return value.to_string();
    };
    let pretty = serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string());
    pretty
        .lines()
        .enumerate()
        .map(|(n, line)| {
            let spaces = line.len() - line.trim_start_matches(' ').len();
            let body = &line[spaces..];
            let lead = if n == 0 { String::new() } else { format!("{indent}{}", unit.repeat(spaces / 2)) };
            format!("{lead}{body}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Inserts `item` (already rendered) as the last child of a container.
fn insert_last(text: &str, c: &Container, last_end: Option<usize>, item: &str, unit: Option<&str>) -> String {
    let outer = line_indent(text, c.open);
    match (last_end, unit) {
        (Some(end), Some(u)) => format!("{},\n{outer}{u}{item}{}", &text[..end], &text[end..]),
        (Some(end), None) => format!("{},{item}{}", &text[..end], &text[end..]),
        (None, Some(u)) => format!("{}\n{outer}{u}{item}\n{outer}{}", &text[..=c.open], &text[c.close..]),
        (None, None) => format!("{}{item}{}", &text[..=c.open], &text[c.close..]),
    }
}

fn splice_add(text: &str) -> Result<String, String> {
    let s = text.as_bytes();
    let unit = indent_unit(text);
    let unit = unit.as_deref();
    let r = root(s)?;
    let (root_members, root_c) = members(s, r)?;
    let group = hook_group();

    let Some(hooks) = find(&root_members, "hooks") else {
        let indent = format!("{}{}", line_indent(text, r), unit.unwrap_or(""));
        let value = render(&json!({ EVENT: [group] }), unit, &indent);
        let item = format!("\"hooks\":{}{value}", if unit.is_some() { " " } else { "" });
        return Ok(insert_last(text, &root_c, root_members.last().map(|m| m.value_end), &item, unit));
    };
    if s[hooks.value_start] != b'{' {
        return Err("\"hooks\" in settings.json is not an object; nothing was changed".into());
    }
    let (hook_members, hooks_c) = members(s, hooks.value_start)?;
    let Some(event) = find(&hook_members, EVENT) else {
        let indent = format!("{}{}", line_indent(text, hooks.value_start), unit.unwrap_or(""));
        let value = render(&json!([group]), unit, &indent);
        let item = format!("\"{EVENT}\":{}{value}", if unit.is_some() { " " } else { "" });
        return Ok(insert_last(text, &hooks_c, hook_members.last().map(|m| m.value_end), &item, unit));
    };
    if s[event.value_start] != b'[' {
        return Err("\"hooks.UserPromptSubmit\" is not a list; nothing was changed".into());
    }
    let (elems, arr_c) = elements(s, event.value_start)?;
    let indent = format!("{}{}", line_indent(text, event.value_start), unit.unwrap_or(""));
    let value = render(&group, unit, &indent);
    Ok(insert_last(text, &arr_c, elems.last().map(|e| e.1), &value, unit))
}

/// Cuts span `i` out of a list of sibling spans, taking one separating
/// comma with it. With no siblings left the container is emptied.
fn cut(text: &str, spans: &[(usize, usize)], i: usize, c: &Container) -> String {
    if spans.len() == 1 {
        return format!("{}{}", &text[..=c.open], &text[c.close..]);
    }
    let (from, to) = if i + 1 < spans.len() {
        (spans[i].0, spans[i + 1].0)
    } else {
        (spans[i - 1].1, spans[i].1)
    };
    format!("{}{}", &text[..from], &text[to..])
}

fn splice_remove_one(text: &str) -> Result<Option<String>, String> {
    let s = text.as_bytes();
    let (root_members, root_c) = members(s, root(s)?)?;
    let Some(hi) = root_members.iter().rposition(|m| m.key == "hooks") else {
        return Ok(None);
    };
    let hooks = &root_members[hi];
    if s[hooks.value_start] != b'{' {
        return Ok(None);
    }
    let (hook_members, hooks_c) = members(s, hooks.value_start)?;
    let Some(ei) = hook_members.iter().rposition(|m| m.key == EVENT) else {
        return Ok(None);
    };
    let event = &hook_members[ei];
    if s[event.value_start] != b'[' {
        return Ok(None);
    }
    let (elems, arr_c) = elements(s, event.value_start)?;
    let Some(ours) = elems.iter().position(|&(a, b)| {
        serde_json::from_str::<Value>(&text[a..b]).is_ok_and(|g| is_ours(&g))
    }) else {
        return Ok(None);
    };
    if elems.len() > 1 {
        return Ok(Some(cut(text, &elems, ours, &arr_c)));
    }
    // Our entry was the only one: drop the event key, and "hooks" if empty.
    if hook_members.len() > 1 {
        let spans: Vec<_> = hook_members.iter().map(|m| (m.start, m.value_end)).collect();
        return Ok(Some(cut(text, &spans, ei, &hooks_c)));
    }
    let spans: Vec<_> = root_members.iter().map(|m| (m.start, m.value_end)).collect();
    Ok(Some(cut(text, &spans, hi, &root_c)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const USER: &str = r#"{
  "model": "opus",
  "autoMode": true,
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "say done" } ] }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "[ -n \"$TERAX_TERMINAL\" ] && printf 'x' || true"
          }
        ]
      }
    ]
  },
  "permissions": { "allow": ["Bash(ls)"] }
}
"#;

    fn ours_count(text: &str) -> usize {
        let v: Value = serde_json::from_str(text).unwrap();
        v["hooks"][EVENT].as_array().map_or(0, |a| a.iter().filter(|g| is_ours(g)).count())
    }

    #[test]
    fn adds_after_existing_hooks_and_keeps_every_other_byte() {
        let out = add(USER).unwrap();
        assert_eq!(ours_count(&out), 1);
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["hooks"][EVENT].as_array().unwrap().len(), 2);
        assert!(v["hooks"][EVENT][0]["hooks"][0]["command"].as_str().unwrap().contains("TERAX_TERMINAL"));
        // Key order and the untouched text survive.
        let head = &USER[..USER.find("\"permissions\"").unwrap()];
        assert!(out.starts_with(&head[..head.find("\n    ]\n  },").unwrap()]));
        assert!(out.ends_with("  \"permissions\": { \"allow\": [\"Bash(ls)\"] }\n}\n"));
        assert!(out.find("\"model\"").unwrap() < out.find("\"autoMode\"").unwrap());
    }

    #[test]
    fn remove_after_add_restores_the_file_exactly() {
        let added = add(USER).unwrap();
        assert_eq!(remove(&added).unwrap(), USER);
    }

    #[test]
    fn re_add_is_idempotent() {
        let once = add(USER).unwrap();
        assert_eq!(add(&once).unwrap(), once);
        assert_eq!(ours_count(&once), 1);
    }

    #[test]
    fn replaces_a_stale_copy_of_our_entry() {
        let stale = add(USER).unwrap().replace("\"timeout\": 2", "\"timeout\": 9");
        assert_eq!(ours_count(&stale), 1);
        let out = add(&stale).unwrap();
        assert_eq!(ours_count(&out), 1);
        assert!(out.contains("\"timeout\": 2"));
        assert_eq!(remove(&out).unwrap(), USER);
    }

    #[test]
    fn preserves_foreign_hooks_on_remove() {
        let added = add(USER).unwrap();
        let out = remove(&added).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["command"], "say done");
        assert_eq!(v["hooks"][EVENT].as_array().unwrap().len(), 1);
        assert_eq!(v["permissions"]["allow"][0], "Bash(ls)");
    }

    #[test]
    fn creates_hooks_when_missing_and_removes_them_again() {
        let plain = "{\n  \"model\": \"opus\"\n}\n";
        let out = add(plain).unwrap();
        assert_eq!(ours_count(&out), 1);
        assert!(out.starts_with("{\n  \"model\": \"opus\",\n  \"hooks\": {\n    \"UserPromptSubmit\": [\n"));
        assert_eq!(remove(&out).unwrap(), plain);
    }

    #[test]
    fn adds_event_into_existing_hooks_object() {
        let text = "{\n  \"hooks\": {\n    \"Stop\": []\n  }\n}";
        let out = add(text).unwrap();
        assert_eq!(ours_count(&out), 1);
        assert_eq!(remove(&out).unwrap(), text);
    }

    #[test]
    fn handles_empty_object_minified_and_tab_files() {
        for text in ["{}", "{\"a\":1,\"hooks\":{\"UserPromptSubmit\":[]}}", "{\n\t\"a\": 1\n}"] {
            let out = add(text).unwrap();
            assert_eq!(ours_count(&out), 1, "{text}");
            assert!(!has_entry(&remove(&out).unwrap()).unwrap(), "{text}");
        }
        assert_eq!(remove(&add("{\n\t\"a\": 1\n}").unwrap()).unwrap(), "{\n\t\"a\": 1\n}");
    }

    #[test]
    fn missing_or_blank_file_gets_a_fresh_one() {
        for text in ["", "  \n"] {
            let out = add(text).unwrap();
            assert_eq!(ours_count(&out), 1);
        }
        assert_eq!(remove("").unwrap(), "");
    }

    #[test]
    fn refuses_invalid_json_and_non_objects() {
        assert!(add("{ not json,").is_err());
        assert!(remove("{ not json,").is_err());
        assert!(add("[1, 2]").is_err());
        assert!(add("{\"hooks\": 3}").is_err());
        assert!(add("{\"hooks\": {\"UserPromptSubmit\": {}}}").is_err());
    }

    #[test]
    fn strings_with_braces_and_escapes_do_not_confuse_the_scanner() {
        let text = "{\n  \"x\": \"} ] \\\" {\",\n  \"hooks\": {}\n}";
        let out = add(text).unwrap();
        assert_eq!(ours_count(&out), 1);
        // "hooks" held only our entry, so it goes with it.
        assert_eq!(remove(&out).unwrap(), "{\n  \"x\": \"} ] \\\" {\"\n}");
    }

    #[test]
    fn has_entry_reports_presence() {
        assert!(!has_entry(USER).unwrap());
        assert!(has_entry(&add(USER).unwrap()).unwrap());
        assert!(has_entry("{ bad").is_err());
    }
}
