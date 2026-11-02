// List prices from prices.json (the only place prices live). Refresh the
// file before each release; see docs/rokk/METER.md.

use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rates {
    pub input: f64,
    pub cache_write5m: f64,
    pub cache_write1h: f64,
    pub cache_read: f64,
    pub output: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPrice {
    pub id: String,
    #[serde(flatten)]
    pub rates: Rates,
    pub context_window: Option<u64>,
    /// Prompts longer than this (input + cache read + cache write) pay `long`.
    pub long_above: Option<u64>,
    pub long: Option<Rates>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceTable {
    pub fetched: String,
    pub us_only_multiplier: f64,
    pub models: Vec<ModelPrice>,
}

pub fn table() -> &'static PriceTable {
    static TABLE: OnceLock<PriceTable> = OnceLock::new();
    TABLE.get_or_init(|| serde_json::from_str(include_str!("prices.json")).expect("prices.json is valid"))
}

/// The price entry for a model id, exact or with a date suffix
/// (`claude-haiku-4-5-20251001`).
pub fn lookup<'a>(table: &'a PriceTable, model: &str) -> Option<&'a ModelPrice> {
    table.models.iter().find(|p| {
        model == p.id
            || model
                .strip_prefix(p.id.as_str())
                .and_then(|rest| rest.strip_prefix('-'))
                .is_some_and(|d| d.len() == 8 && d.bytes().all(|b| b.is_ascii_digit()))
    })
}

/// One response's usage, for pricing.
#[derive(Clone, Copy, Debug, Default)]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    /// All cache writes; the 5m and 1h parts below when the file splits them.
    pub cache_write: u64,
    pub write_5m: u64,
    pub write_1h: u64,
}

/// US dollars at list price for one response.
pub fn estimate(price: &ModelPrice, t: Tokens, us_only: bool, multiplier: f64) -> f64 {
    let prompt = t.input + t.cache_read + t.cache_write;
    let r = match (price.long_above, price.long) {
        (Some(limit), Some(long)) if prompt > limit => long,
        _ => price.rates,
    };
    // Writes the file does not split are priced as 5-minute writes.
    let unsplit = t.cache_write.saturating_sub(t.write_5m + t.write_1h);
    let usd = (t.input as f64 * r.input
        + (t.write_5m + unsplit) as f64 * r.cache_write5m
        + t.write_1h as f64 * r.cache_write1h
        + t.cache_read as f64 * r.cache_read
        + t.output as f64 * r.output)
        / 1_000_000.0;
    if us_only {
        usd * multiplier
    } else {
        usd
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_parses_and_has_a_date() {
        let t = table();
        assert!(!t.models.is_empty());
        assert_eq!(t.fetched.len(), 10);
        assert!(lookup(t, "claude-opus-5-5").is_some());
    }

    #[test]
    fn matches_exact_ids_and_dated_ids_only() {
        let t = table();
        assert_eq!(lookup(t, "claude-haiku-4-5-20251001").unwrap().id, "claude-haiku-4-5");
        assert_eq!(lookup(t, "claude-opus-5").unwrap().id, "claude-opus-5");
        assert!(lookup(t, "claude-opus-5-x").is_none());
        assert!(lookup(t, "gpt-5").is_none());
        assert!(lookup(t, "<synthetic>").is_none());
    }

    #[test]
    fn prices_each_token_kind() {
        let p = ModelPrice {
            id: "m".into(),
            rates: Rates { input: 1.0, cache_write5m: 2.0, cache_write1h: 3.0, cache_read: 0.5, output: 10.0 },
            context_window: None,
            long_above: None,
            long: None,
        };
        let t = Tokens { input: 1_000_000, output: 1_000_000, cache_read: 1_000_000, cache_write: 3_000_000, write_5m: 1_000_000, write_1h: 1_000_000 };
        // 1 + 10 + 0.5 + 2 (5m) + 3 (1h) + 2 (unsplit as 5m)
        assert!((estimate(&p, t, false, 1.1) - 18.5).abs() < 1e-9);
        assert!((estimate(&p, t, true, 1.1) - 20.35).abs() < 1e-9);
    }

    #[test]
    fn long_prompts_use_the_long_rates() {
        let t = table();
        let haiku = lookup(t, "claude-haiku-5-5").unwrap();
        let short = Tokens { input: 100_000, ..Default::default() };
        let long = Tokens { input: 100_001, ..Default::default() };
        assert!((estimate(haiku, short, false, 1.0) - 0.01).abs() < 1e-9);
        assert!((estimate(haiku, long, false, 1.0) - 0.0500005).abs() < 1e-9);
    }
}
