// Parses Claude Code session lines into numbers. Text never leaves a line:
// message content is skipped while parsing, and only ids, model names and
// tool names are kept, after validation.
//
// Format (verified on Claude Code 2.1.316, see docs/rokk/METER.md):
// - `assistant` lines carry `message.usage`; one response is written as one
//   line per content block, repeating the usage, with earlier lines sometimes
//   holding a partial output count. De-duplicated by `message.id`, keeping
//   the largest value of each field.
// - A prompt is a `user` line whose content is text or blocks without a
//   `tool_result`, not `isMeta`, not `isCompactSummary`, not a sidechain,
//   and typed by a human (`promptSource` "typed" / `origin.kind` "human"
//   when those fields are present).
// - Sub-agents write their own files with `isSidechain: true`; their usage
//   counts in totals but not in the context size.

use super::prices::{self, PriceTable, Tokens};
use serde::de::{Deserializer, IgnoredAny, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Rows returned per snapshot.
pub const PROMPT_ROWS: usize = 30;

// --- Line shapes (only the fields we use) ---

#[derive(Deserialize, Default)]
#[serde(default)]
struct Line {
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(rename = "isSidechain")]
    sidechain: Option<bool>,
    #[serde(rename = "isMeta")]
    meta: Option<bool>,
    #[serde(rename = "isCompactSummary")]
    compact_summary: Option<bool>,
    #[serde(rename = "promptSource")]
    prompt_source: Option<String>,
    origin: Option<Origin>,
    timestamp: Option<String>,
    message: Option<Message>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Origin {
    kind: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Message {
    id: Option<String>,
    model: Option<String>,
    usage: Option<Usage>,
    content: Content,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Usage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_creation: Option<CacheCreation>,
    speed: Option<String>,
    inference_geo: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct CacheCreation {
    ephemeral_5m_input_tokens: Option<u64>,
    ephemeral_1h_input_tokens: Option<u64>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Block {
    #[serde(rename = "type")]
    kind: Option<String>,
    id: Option<String>,
    name: Option<String>,
}

/// Message content. Text is recognized and dropped, never stored.
#[derive(Default)]
enum Content {
    #[default]
    Absent,
    Text,
    Blocks(Vec<Block>),
}

impl<'de> Deserialize<'de> for Content {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Content;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("message content")
            }
            fn visit_str<E>(self, _: &str) -> Result<Content, E> {
                Ok(Content::Text)
            }
            fn visit_unit<E>(self) -> Result<Content, E> {
                Ok(Content::Absent)
            }
            fn visit_none<E>(self) -> Result<Content, E> {
                Ok(Content::Absent)
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut m: A) -> Result<Content, A::Error> {
                while m.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(Content::Absent)
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut s: A) -> Result<Content, A::Error> {
                let mut blocks = Vec::new();
                while let Some(b) = s.next_element::<Block>()? {
                    blocks.push(b);
                }
                Ok(Content::Blocks(blocks))
            }
        }
        d.deserialize_any(V)
    }
}

// --- Validation of the only strings we keep ---

fn clean_model(m: &str) -> Option<String> {
    let ok = !m.is_empty()
        && m.len() <= 64
        && m.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'[' | b']'));
    ok.then(|| m.to_string())
}

fn clean_tool(n: &str) -> String {
    let ok = !n.is_empty()
        && n.len() <= 64
        && n.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'));
    if ok {
        n.to_string()
    } else {
        "Other".to_string()
    }
}

/// `2026-11-01T19:08:24.123Z` in unix milliseconds.
pub fn parse_ts(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<i64> { std::str::from_utf8(&b[r]).ok()?.parse().ok() };
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let mut ms = 0i64;
    if b.get(19) == Some(&b'.') {
        let digits: Vec<u8> = b[20..].iter().copied().take_while(u8::is_ascii_digit).collect();
        let mut frac = 0i64;
        for (i, dgt) in digits.iter().take(3).enumerate() {
            frac += i64::from(dgt - b'0') * [100, 10, 1][i];
        }
        ms = frac;
    }
    // days_from_civil (H. Hinnant)
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let total = ((days * 24 + h) * 60 + mi) * 60 + sec;
    u64::try_from(total * 1000 + ms).ok()
}

// --- Accumulated state (numbers, ids, model and tool names only) ---

#[derive(Clone, Debug, Default)]
struct Resp {
    model: Option<String>,
    t: Tokens,
    at_ms: u64,
    sidechain: bool,
    fast: bool,
    us_only: bool,
}

#[derive(Default)]
pub struct Session {
    responses: HashMap<String, Resp>,
    tool_ids: HashSet<String>,
    tool_counts: BTreeMap<String, u64>,
    tool_times: Vec<u64>,
    prompt_starts: Vec<u64>,
    last_main: Option<String>,
    last_reply_ms: Option<u64>,
    ttl_secs: Option<u64>,
    last_ts: u64,
    pub skipped: u64,
}

impl Session {
    /// Feeds one line. Malformed lines are counted, never an error.
    pub fn feed(&mut self, raw: &[u8]) {
        let line: Line = match serde_json::from_slice(raw) {
            Ok(l) => l,
            Err(_) => {
                // Valid JSON of another shape is simply not ours.
                if serde_json::from_slice::<IgnoredAny>(raw).is_err() {
                    self.skipped += 1;
                }
                return;
            }
        };
        let at = line.timestamp.as_deref().and_then(parse_ts).unwrap_or(self.last_ts);
        self.last_ts = self.last_ts.max(at);
        let sidechain = line.sidechain.unwrap_or(false);
        match line.kind.as_deref() {
            Some("user") => self.user(&line, at, sidechain),
            Some("assistant") => self.assistant(line, at, sidechain),
            _ => {}
        }
    }

    fn user(&mut self, line: &Line, at: u64, sidechain: bool) {
        let Some(msg) = &line.message else { return };
        let human = line.prompt_source.as_deref().is_none_or(|s| s == "typed")
            && line.origin.as_ref().and_then(|o| o.kind.as_deref()).is_none_or(|k| k == "human");
        let typed = match &msg.content {
            Content::Text => true,
            Content::Blocks(bs) => !bs.is_empty() && !bs.iter().any(|b| b.kind.as_deref() == Some("tool_result")),
            Content::Absent => false,
        };
        if typed && human && !sidechain && !line.meta.unwrap_or(false) && !line.compact_summary.unwrap_or(false) {
            self.prompt_starts.push(at);
        }
    }

    fn assistant(&mut self, line: Line, at: u64, sidechain: bool) {
        let Some(msg) = line.message else { return };
        let model = msg.model.as_deref().and_then(clean_model);
        if msg.model.as_deref() == Some("<synthetic>") {
            return;
        }
        let Some(id) = msg.id.filter(|i| super::paths::valid_id(i) || i.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')) else {
            return;
        };
        if let Content::Blocks(blocks) = &msg.content {
            for b in blocks {
                if b.kind.as_deref() != Some("tool_use") {
                    continue;
                }
                let (Some(tid), Some(name)) = (&b.id, &b.name) else { continue };
                if self.tool_ids.insert(tid.clone()) {
                    *self.tool_counts.entry(clean_tool(name)).or_default() += 1;
                    self.tool_times.push(at);
                }
            }
        }
        let Some(u) = msg.usage else { return };
        let r = self.responses.entry(id.clone()).or_insert_with(|| Resp { at_ms: at, sidechain, ..Default::default() });
        let w = u.cache_creation.unwrap_or_default();
        let max = |a: &mut u64, b: Option<u64>| *a = (*a).max(b.unwrap_or(0));
        max(&mut r.t.input, u.input_tokens);
        max(&mut r.t.output, u.output_tokens);
        max(&mut r.t.cache_read, u.cache_read_input_tokens);
        max(&mut r.t.cache_write, u.cache_creation_input_tokens);
        max(&mut r.t.write_5m, w.ephemeral_5m_input_tokens);
        max(&mut r.t.write_1h, w.ephemeral_1h_input_tokens);
        if model.is_some() {
            r.model = model;
        }
        r.fast |= u.speed.as_deref().is_some_and(|s| s != "standard");
        r.us_only |= u.inference_geo.as_deref() == Some("us");
        if !sidechain {
            self.last_main = Some(id);
            self.last_reply_ms = Some(self.last_reply_ms.unwrap_or(0).max(at));
            if w.ephemeral_1h_input_tokens.unwrap_or(0) > 0 {
                self.ttl_secs = Some(3600);
            } else if w.ephemeral_5m_input_tokens.unwrap_or(0) > 0 {
                self.ttl_secs = Some(300);
            }
        }
    }

    pub fn snapshot(&self, session_id: &str, table: &PriceTable) -> Snapshot {
        let mut totals = Totals { prompts: self.prompt_starts.len() as u64, ..Default::default() };
        let mut models: BTreeMap<String, ModelTotals> = BTreeMap::new();
        let mut estimate = 0.0;
        let mut priced_any = false;
        let mut partial = false;
        let mut resps: Vec<&Resp> = self.responses.values().collect();
        resps.sort_by_key(|r| r.at_ms);
        for r in &resps {
            let t = r.t;
            totals.input += t.input;
            totals.output += t.output;
            totals.cache_read += t.cache_read;
            totals.cache_write += t.cache_write;
            totals.responses += 1;
            let name = r.model.clone().unwrap_or_else(|| "unknown".into());
            let m = models.entry(name.clone()).or_insert_with(|| ModelTotals { model: name.clone(), ..Default::default() });
            m.input += t.input;
            m.output += t.output;
            m.cache_read += t.cache_read;
            m.cache_write += t.cache_write;
            m.responses += 1;
            match prices::lookup(table, &name).filter(|_| !r.fast) {
                Some(p) => {
                    let usd = prices::estimate(p, t, r.us_only, table.us_only_multiplier);
                    estimate += usd;
                    priced_any = true;
                    *m.estimate_usd.get_or_insert(0.0) += usd;
                }
                None => {
                    partial = true;
                    m.unpriced = true;
                }
            }
        }

        // Per-prompt rows by time: a response or tool call belongs to the
        // latest prompt that started at or before it.
        let n = self.prompt_starts.len();
        let first = n.saturating_sub(PROMPT_ROWS);
        let mut prompts: Vec<PromptRow> = (first..n)
            .map(|i| PromptRow { index: i as u64 + 1, started_ms: self.prompt_starts[i], tokens: 0, tool_calls: 0 })
            .collect();
        let row_for = |at: u64| -> Option<usize> {
            let k = self.prompt_starts.partition_point(|s| *s <= at);
            (k > first).then(|| k - 1 - first)
        };
        for r in &resps {
            if let Some(i) = row_for(r.at_ms) {
                prompts[i].tokens += r.t.input + r.t.output + r.t.cache_read + r.t.cache_write;
            }
        }
        for at in &self.tool_times {
            if let Some(i) = row_for(*at) {
                prompts[i].tool_calls += 1;
            }
        }

        let latest = self.last_main.as_ref().and_then(|id| self.responses.get(id));
        let context_model = latest.and_then(|r| r.model.clone());
        Snapshot {
            session_id: session_id.to_string(),
            offset: 0,
            reset: false,
            caught_up: true,
            totals,
            models: models.into_values().collect(),
            prompts,
            context_tokens: latest.map(|r| r.t.input + r.t.cache_read + r.t.cache_write),
            context_window: context_model
                .as_deref()
                .and_then(|m| prices::lookup(table, m))
                .and_then(|p| p.context_window),
            context_model,
            last_reply_ms: self.last_reply_ms,
            cache_ttl_secs: self.ttl_secs,
            tools: self.tool_counts.iter().map(|(name, count)| ToolCount { name: name.clone(), count: *count }).collect(),
            estimate_usd: priced_any.then_some(estimate),
            estimate_partial: partial,
            skipped_lines: self.skipped,
        }
    }
}

// --- What the frontend gets: numbers, times, ids, model and tool names ---

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub responses: u64,
    pub prompts: u64,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelTotals {
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub responses: u64,
    pub estimate_usd: Option<f64>,
    pub unpriced: bool,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PromptRow {
    pub index: u64,
    pub started_ms: u64,
    pub tokens: u64,
    pub tool_calls: u64,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCount {
    pub name: String,
    pub count: u64,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub session_id: String,
    pub offset: u64,
    /// The reader started again from the beginning (new session, truncation).
    pub reset: bool,
    /// The whole file has been read.
    pub caught_up: bool,
    pub totals: Totals,
    pub models: Vec<ModelTotals>,
    pub prompts: Vec<PromptRow>,
    pub context_tokens: Option<u64>,
    pub context_window: Option<u64>,
    pub context_model: Option<String>,
    pub last_reply_ms: Option<u64>,
    pub cache_ttl_secs: Option<u64>,
    pub tools: Vec<ToolCount>,
    pub estimate_usd: Option<f64>,
    pub estimate_partial: bool,
    pub skipped_lines: u64,
}

#[cfg(test)]
pub mod fixtures {
    //! Synthetic session lines. Never real data.
    use serde_json::json;

    pub fn prompt(ts: &str) -> String {
        json!({"type": "user", "timestamp": ts, "promptSource": "typed", "origin": {"kind": "human"},
               "message": {"role": "user", "content": "SECRET-PROMPT-TEXT please"}})
        .to_string()
    }

    pub fn tool_result(ts: &str) -> String {
        json!({"type": "user", "timestamp": ts, "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_1", "content": "SECRET-TOOL-OUTPUT /Users/me/secret.txt"}]}})
        .to_string()
    }

    pub fn reply(ts: &str, id: &str, input: u64, output: u64, read: u64, write: u64) -> String {
        reply_full(ts, id, input, output, read, write, false, None)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn reply_full(ts: &str, id: &str, input: u64, output: u64, read: u64, write: u64, sidechain: bool, tool: Option<(&str, &str)>) -> String {
        let content = match tool {
            Some((tid, name)) => json!([{"type": "tool_use", "id": tid, "name": name,
                                         "input": {"file_path": "/Users/me/SECRET-PATH.rs", "command": "cat SECRET"}}]),
            None => json!([{"type": "text", "text": "SECRET-ASSISTANT-TEXT"}]),
        };
        json!({"type": "assistant", "timestamp": ts, "isSidechain": sidechain, "requestId": format!("req_{id}"),
               "message": {"id": id, "model": "claude-opus-5-5", "role": "assistant", "content": content,
                           "usage": {"input_tokens": input, "output_tokens": output,
                                     "cache_read_input_tokens": read, "cache_creation_input_tokens": write,
                                     "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": write},
                                     "speed": "standard", "inference_geo": "global"}}})
        .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;

    fn feed(lines: &[String]) -> Session {
        let mut s = Session::default();
        for l in lines {
            s.feed(l.as_bytes());
        }
        s
    }

    fn snap(s: &Session) -> Snapshot {
        s.snapshot("sess-1", prices::table())
    }

    #[test]
    fn parses_timestamps() {
        assert_eq!(parse_ts("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_ts("2026-11-01T19:08:24.123Z"), Some(1_793_560_104_123));
        assert_eq!(parse_ts("2026-11-01T19:08:24Z"), Some(1_793_560_104_000));
        assert_eq!(parse_ts("nope"), None);
    }

    #[test]
    fn collapses_repeated_lines_of_one_response_keeping_the_final_output() {
        let s = feed(&[
            prompt("2026-11-01T10:00:00.000Z"),
            reply("2026-11-01T10:00:01.000Z", "msg_1", 3, 8, 1000, 50),
            reply("2026-11-01T10:00:01.500Z", "msg_1", 3, 8, 1000, 50),
            reply("2026-11-01T10:00:02.000Z", "msg_1", 3, 600, 1000, 50),
        ]);
        let t = snap(&s).totals;
        assert_eq!((t.input, t.output, t.cache_read, t.cache_write, t.responses), (3, 600, 1000, 50, 1));
    }

    #[test]
    fn tool_results_are_not_prompts_and_tool_calls_are_counted_by_name_once() {
        let s = feed(&[
            prompt("2026-11-01T10:00:00.000Z"),
            reply_full("2026-11-01T10:00:01.000Z", "msg_1", 1, 10, 0, 0, false, Some(("toolu_1", "Read"))),
            reply_full("2026-11-01T10:00:01.000Z", "msg_1", 1, 10, 0, 0, false, Some(("toolu_1", "Read"))),
            tool_result("2026-11-01T10:00:02.000Z"),
            reply_full("2026-11-01T10:00:03.000Z", "msg_2", 1, 10, 0, 0, false, Some(("toolu_2", "Edit"))),
            tool_result("2026-11-01T10:00:04.000Z"),
            reply_full("2026-11-01T10:00:05.000Z", "msg_3", 1, 10, 0, 0, false, Some(("toolu_3", "Read"))),
        ]);
        let sn = snap(&s);
        assert_eq!(sn.totals.prompts, 1);
        assert_eq!(sn.tools, vec![ToolCount { name: "Edit".into(), count: 1 }, ToolCount { name: "Read".into(), count: 2 }]);
        assert_eq!(sn.prompts[0].tool_calls, 3);
    }

    #[test]
    fn meta_compact_summary_and_system_prompts_are_not_counted() {
        let meta = serde_json::json!({"type": "user", "isMeta": true, "message": {"content": "x"}}).to_string();
        let summary = serde_json::json!({"type": "user", "isCompactSummary": true, "message": {"content": "x"}}).to_string();
        let system = serde_json::json!({"type": "user", "promptSource": "system", "origin": {"kind": "task-notification"}, "message": {"content": "x"}}).to_string();
        let boundary = serde_json::json!({"type": "system", "subtype": "compact_boundary"}).to_string();
        let s = feed(&[meta, summary, system, boundary, prompt("2026-11-01T10:00:00.000Z")]);
        assert_eq!(snap(&s).totals.prompts, 1);
    }

    #[test]
    fn groups_responses_by_prompt_and_keeps_the_last_30_rows() {
        let mut lines = Vec::new();
        for i in 0..35u64 {
            lines.push(prompt(&format!("2026-11-01T10:{:02}:00.000Z", i)));
            lines.push(reply(&format!("2026-11-01T10:{:02}:10.000Z", i), &format!("msg_{i}a"), 1, i, 0, 0));
            lines.push(reply(&format!("2026-11-01T10:{:02}:20.000Z", i), &format!("msg_{i}b"), 1, 1, 0, 0));
        }
        let sn = snap(&feed(&lines));
        assert_eq!(sn.totals.prompts, 35);
        assert_eq!(sn.prompts.len(), PROMPT_ROWS);
        assert_eq!(sn.prompts[0].index, 6);
        let last = sn.prompts.last().unwrap();
        assert_eq!((last.index, last.tokens), (35, 1 + 34 + 1 + 1));
    }

    #[test]
    fn context_is_the_latest_main_response_and_ignores_sidechains() {
        let s = feed(&[
            prompt("2026-11-01T10:00:00.000Z"),
            reply("2026-11-01T10:00:01.000Z", "msg_1", 2, 10, 40_000, 2_000),
            reply_full("2026-11-01T10:00:02.000Z", "msg_side", 5, 10, 90_000, 0, true, None),
        ]);
        let sn = snap(&s);
        assert_eq!(sn.context_tokens, Some(42_002));
        assert_eq!(sn.context_window, Some(1_000_000));
        assert_eq!(sn.context_model.as_deref(), Some("claude-opus-5-5"));
        // Sidechain usage still counts in the totals.
        assert_eq!(sn.totals.responses, 2);
        assert_eq!(sn.totals.cache_read, 130_000);
        assert_eq!(sn.cache_ttl_secs, Some(3600));
    }

    #[test]
    fn malformed_lines_are_counted_and_skipped() {
        let s = feed(&[
            "{not json".to_string(),
            "[1,2]".to_string(),
            r#"{"type":"assistant","message":{"usage":"weird"}}"#.to_string(),
            prompt("2026-11-01T10:00:00.000Z"),
        ]);
        let sn = snap(&s);
        assert_eq!(sn.skipped_lines, 1);
        assert_eq!(sn.totals.prompts, 1);
    }

    #[test]
    fn synthetic_and_unknown_models() {
        let synthetic = reply("2026-11-01T10:00:01.000Z", "msg_s", 0, 0, 0, 0).replace("claude-opus-5-5", "<synthetic>");
        let other = reply("2026-11-01T10:00:02.000Z", "msg_o", 1_000_000, 0, 0, 0).replace("claude-opus-5-5", "gpt-x");
        let known = reply("2026-11-01T10:00:03.000Z", "msg_k", 1_000_000, 0, 0, 0);
        let sn = snap(&feed(&[synthetic, other, known]));
        assert_eq!(sn.totals.responses, 2);
        assert!(sn.estimate_partial);
        assert!((sn.estimate_usd.unwrap() - 4.0).abs() < 1e-9);
        assert!(sn.models.iter().any(|m| m.model == "gpt-x" && m.unpriced && m.estimate_usd.is_none()));
    }

    #[test]
    fn snapshot_has_no_free_text_fields() {
        let s = feed(&[
            prompt("2026-11-01T10:00:00.000Z"),
            reply_full("2026-11-01T10:00:01.000Z", "msg_1", 1, 2, 3, 4, false, Some(("toolu_1", "Bash"))),
            tool_result("2026-11-01T10:00:02.000Z"),
            reply_full("2026-11-01T10:00:03.000Z", "msg_2", 1, 2, 3, 4, true, Some(("toolu_2", "Read"))),
        ]);
        let value = serde_json::to_value(snap(&s)).unwrap();
        let mut strings = Vec::new();
        walk(&value, "", &mut strings);
        let allowed = ["sessionId", "models[].model", "contextModel", "tools[].name"];
        for (path, text) in &strings {
            assert!(allowed.contains(&path.as_str()), "unexpected string field {path}");
            assert!(!text.contains("SECRET"), "{path} leaked text");
        }
        let all = value.to_string();
        assert!(!all.contains("SECRET") && !all.contains("/Users/"));
    }

    fn walk(v: &serde_json::Value, path: &str, out: &mut Vec<(String, String)>) {
        match v {
            serde_json::Value::String(s) => out.push((path.to_string(), s.clone())),
            serde_json::Value::Array(a) => a.iter().for_each(|x| walk(x, &format!("{path}[]"), out)),
            serde_json::Value::Object(o) => o.iter().for_each(|(k, x)| {
                let p = if path.is_empty() { k.clone() } else { format!("{path}.{k}") };
                walk(x, &p, out)
            }),
            _ => {}
        }
    }

    #[test]
    fn odd_tool_and_model_names_are_replaced() {
        assert_eq!(clean_tool("mcp__server__tool"), "mcp__server__tool");
        assert_eq!(clean_tool("rm -rf /"), "Other");
        assert_eq!(clean_model("claude opus"), None);
        assert_eq!(clean_model("claude-opus-5-5[1m]").as_deref(), Some("claude-opus-5-5[1m]"));
    }
}
