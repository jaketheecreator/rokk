// Share links in a chosen browser and Chrome profile. Links opened through
// the system default go to Chromium's last used profile; this lets the
// person pick the browser and, for Chromium browsers, the profile.
// Reads only each browser's "Local State" file (profile folder and display
// name, nothing else). Opens only https links on the share allow-list,
// through /usr/bin/open with an argument array (no shell).
// See docs/rokk/SHARE.md.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

/// The browsers Rokk looks for: id (bundle id), name, the folder under
/// ~/Library/Application Support that holds "Local State" (Chromium browsers
/// whose profiles Rokk can choose), or None.
pub const KNOWN: [(&str, &str, Option<&str>); 11] = [
    ("com.google.Chrome", "Google Chrome", Some("Google/Chrome")),
    (
        "com.google.Chrome.beta",
        "Chrome Beta",
        Some("Google/Chrome Beta"),
    ),
    (
        "com.google.Chrome.canary",
        "Chrome Canary",
        Some("Google/Chrome Canary"),
    ),
    (
        "com.brave.Browser",
        "Brave",
        Some("BraveSoftware/Brave-Browser"),
    ),
    (
        "com.microsoft.edgemac",
        "Microsoft Edge",
        Some("Microsoft Edge"),
    ),
    ("com.vivaldi.Vivaldi", "Vivaldi", Some("Vivaldi")),
    // Chromium based, but their profiles are not chosen with
    // --profile-directory (Opera's own profiles, Arc's Spaces).
    ("com.operasoftware.Opera", "Opera", None),
    ("company.thebrowser.Browser", "Arc", None),
    ("org.mozilla.firefox", "Firefox", None),
    ("com.apple.Safari", "Safari", None),
    (
        "com.google.Chrome.dev",
        "Chrome Dev",
        Some("Google/Chrome Dev"),
    ),
];

/// The hosts a Share link may open.
pub const ALLOWED_HOSTS: [&str; 7] = [
    "x.com",
    "twitter.com",
    "www.linkedin.com",
    "linkedin.com",
    "studio.youtube.com",
    "www.youtube.com",
    "youtube.com",
];

/// The most "Local State" Rokk reads.
pub const MAX_LOCAL_STATE: u64 = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Browser {
    pub id: String,
    pub name: String,
    pub app_path: String,
    pub supports_profiles: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Profile {
    pub dir: String,
    pub name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Opened {
    /// The chosen browser could not be used, so the default one opened it.
    pub fallback: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenError {
    NotAllowed,
    UnknownBrowser,
    UnknownProfile,
    OpenFailed,
}

/// A profile folder name as Chromium makes them ("Default", "Profile 3",
/// "Guest Profile"): letters, digits and spaces only, at most 64.
pub fn plausible_dir(dir: &str) -> bool {
    !dir.is_empty()
        && dir.len() <= 64
        && dir.bytes().all(|b| b.is_ascii_alphanumeric() || b == b' ')
}

/// Profiles from a "Local State" file: profile.info_cache, keeping only the
/// folder and the display name. Every other field (emails, gaia names,
/// avatars) is dropped here. Anything odd gives an empty list.
pub fn parse_local_state(bytes: &[u8]) -> Vec<Profile> {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return Vec::new();
    };
    let Some(cache) = v
        .get("profile")
        .and_then(|p| p.get("info_cache"))
        .and_then(|c| c.as_object())
    else {
        return Vec::new();
    };
    let mut out: Vec<Profile> = cache
        .iter()
        .filter(|(dir, _)| plausible_dir(dir))
        .filter_map(|(dir, info)| {
            let name = info.get("name")?.as_str()?.trim();
            let name: String = name.chars().filter(|c| !c.is_control()).take(80).collect();
            (!name.is_empty()).then(|| Profile {
                dir: dir.clone(),
                name,
            })
        })
        .collect();
    out.sort_by(|a, b| a.dir.cmp(&b.dir));
    // Two profiles with one name: add the folder so the picker can tell them
    // apart.
    let names: Vec<String> = out.iter().map(|p| p.name.clone()).collect();
    for p in &mut out {
        if names.iter().filter(|n| **n == p.name).count() > 1 {
            p.name = format!("{} ({})", p.name, p.dir);
        }
    }
    out
}

/// Reads at most MAX_LOCAL_STATE bytes; a larger file counts as unreadable.
pub fn read_bounded(path: &Path) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    file.take(MAX_LOCAL_STATE + 1).read_to_end(&mut buf).ok()?;
    (buf.len() as u64 <= MAX_LOCAL_STATE).then_some(buf)
}

pub fn local_state_path(home: &Path, support_dir: &str) -> PathBuf {
    home.join("Library")
        .join("Application Support")
        .join(support_dir)
        .join("Local State")
}

/// A Share link: https, an allowed host exactly (any case), no user info,
/// no port, no whitespace or control characters.
pub fn allowed_url(url: &str) -> bool {
    if url.len() > 8192 || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let Some(rest) = url
        .get(..8)
        .filter(|s| s.eq_ignore_ascii_case("https://"))
        .map(|_| &url[8..])
    else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if host.contains(['@', ':', '\\', '%']) {
        return false;
    }
    ALLOWED_HOSTS.iter().any(|h| h.eq_ignore_ascii_case(host))
}

/// The `open` arguments: the default browser, an app, or a Chromium app in
/// a profile (-n so the running browser gets --args). The url is always one
/// argument of its own.
pub fn open_args(app_path: Option<&str>, profile_dir: Option<&str>, url: &str) -> Vec<String> {
    match (app_path, profile_dir) {
        (None, _) => vec![url.to_string()],
        (Some(app), None) => vec!["-a".into(), app.into(), url.into()],
        (Some(app), Some(dir)) => {
            vec![
                "-na".into(),
                app.into(),
                "--args".into(),
                format!("--profile-directory={dir}"),
                url.into(),
            ]
        }
    }
}

/// Runs `open`; on failure with a chosen browser, opens the default one and
/// reports the fallback. `run` runs /usr/bin/open with the arguments.
pub fn open_with(
    app_path: Option<&str>,
    profile_dir: Option<&str>,
    url: &str,
    run: &mut dyn FnMut(&[String]) -> bool,
) -> Result<Opened, OpenError> {
    if run(&open_args(app_path, profile_dir, url)) {
        return Ok(Opened { fallback: false });
    }
    if app_path.is_some() && run(&open_args(None, None, url)) {
        return Ok(Opened { fallback: true });
    }
    Err(OpenError::OpenFailed)
}

#[cfg(target_os = "macos")]
fn app_for(bundle_id: &str, home: &Path) -> Option<String> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::NSString;
    let url = NSWorkspace::sharedWorkspace()
        .URLForApplicationWithBundleIdentifier(&NSString::from_str(bundle_id))?;
    let path = url.path()?.to_string();
    let user_apps = home.join("Applications");
    // Installed apps only: /Applications, ~/Applications, and Safari's
    // system location.
    let ok = path.ends_with(".app")
        && (path.starts_with("/Applications/")
            || Path::new(&path).starts_with(&user_apps)
            || (bundle_id == "com.apple.Safari" && path.starts_with("/System/")));
    (ok && Path::new(&path).is_dir()).then_some(path)
}

#[cfg(not(target_os = "macos"))]
fn app_for(_: &str, _: &Path) -> Option<String> {
    None
}

pub fn list(home: &Path) -> Vec<Browser> {
    KNOWN
        .iter()
        .filter_map(|(id, name, support)| {
            Some(Browser {
                id: id.to_string(),
                name: name.to_string(),
                app_path: app_for(id, home)?,
                supports_profiles: support.is_some(),
            })
        })
        .collect()
}

pub fn profiles(home: &Path, browser_id: &str) -> Vec<Profile> {
    KNOWN
        .iter()
        .find(|(id, _, _)| *id == browser_id)
        .and_then(|(_, _, support)| *support)
        .and_then(|support| read_bounded(&local_state_path(home, support)))
        .map(|b| parse_local_state(&b))
        .unwrap_or_default()
}

fn run_open(args: &[String]) -> bool {
    std::process::Command::new("/usr/bin/open")
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Checks everything again at call time, then opens.
pub fn open(
    home: &Path,
    url: &str,
    browser_id: Option<&str>,
    profile_dir: Option<&str>,
) -> Result<Opened, OpenError> {
    if !allowed_url(url) {
        return Err(OpenError::NotAllowed);
    }
    let app = match browser_id {
        None => None,
        Some(id) => Some(
            list(home)
                .into_iter()
                .find(|b| b.id == id)
                .ok_or(OpenError::UnknownBrowser)?,
        ),
    };
    if let Some(dir) = profile_dir {
        let known = app.as_ref().is_some_and(|b| {
            b.supports_profiles && profiles(home, &b.id).iter().any(|p| p.dir == dir)
        });
        if !known || !plausible_dir(dir) {
            return Err(OpenError::UnknownProfile);
        }
    }
    let result = open_with(
        app.as_ref().map(|b| b.app_path.as_str()),
        profile_dir,
        url,
        &mut |a| run_open(a),
    );
    log::info!(
        "[rokk_share] open chosen={} profile={} fallback={}",
        app.is_some(),
        profile_dir.is_some(),
        matches!(result, Ok(Opened { fallback: true }))
    );
    result
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_default()
}

#[tauri::command]
pub async fn list_browsers() -> Vec<Browser> {
    tauri::async_runtime::spawn_blocking(|| list(&home()))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn list_browser_profiles(browser_id: String) -> Vec<Profile> {
    tauri::async_runtime::spawn_blocking(move || profiles(&home(), &browser_id))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn open_share_url(
    url: String,
    browser_id: Option<String>,
    profile_dir: Option<String>,
) -> Result<Opened, OpenError> {
    tauri::async_runtime::spawn_blocking(move || {
        open(&home(), &url, browser_id.as_deref(), profile_dir.as_deref())
    })
    .await
    .unwrap_or(Err(OpenError::OpenFailed))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{"browser":{"enabled_labs_experiments":[]},
      "profile":{"info_cache":{
        "Default":{"name":"Personal","user_name":"me@example.com","gaia_name":"Real Name","gaia_given_name":"Real","avatar_icon":"chrome://theme/IDR_PROFILE_AVATAR_26","last_downloaded_gaia_picture_url_with_size":"https://lh3.example/x"},
        "Profile 1":{"name":"Work","user_name":"work@corp.example","is_using_default_avatar":false},
        "Profile 3":{"name":"Claude\u0007","gaia_id":"123"},
        "../evil":{"name":"Bad"},
        "Profile 4":{"user_name":"no-name@example.com"},
        "Profile 5":{"name":"Work"}
      },"last_used":"Profile 1"}}"#;

    #[test]
    fn local_state_keeps_only_folder_and_display_name() {
        let p = parse_local_state(SAMPLE.as_bytes());
        assert_eq!(
            p,
            vec![
                Profile {
                    dir: "Default".into(),
                    name: "Personal".into()
                },
                Profile {
                    dir: "Profile 1".into(),
                    name: "Work (Profile 1)".into()
                },
                Profile {
                    dir: "Profile 3".into(),
                    name: "Claude".into()
                },
                Profile {
                    dir: "Profile 5".into(),
                    name: "Work (Profile 5)".into()
                },
            ]
        );
        let json = serde_json::to_string(&p).unwrap();
        for secret in [
            "@",
            "Real Name",
            "gaia",
            "avatar",
            "lh3",
            "123",
            "evil",
            "user_name",
        ] {
            assert!(!json.contains(secret), "{secret} leaked: {json}");
        }
    }

    #[test]
    fn local_state_malformed_or_huge_gives_nothing() {
        assert!(parse_local_state(b"{not json").is_empty());
        assert!(parse_local_state(b"[]").is_empty());
        assert!(parse_local_state(br#"{"profile":{"info_cache":[]}}"#).is_empty());
        let d = tempfile::tempdir().unwrap();
        let big = d.path().join("Local State");
        let mut s = String::from(r#"{"profile":{"info_cache":{"Default":{"name":"A"}}},"pad":""#);
        s.push_str(&"x".repeat(MAX_LOCAL_STATE as usize));
        s.push_str("\"}");
        std::fs::write(&big, &s).unwrap();
        assert!(read_bounded(&big).is_none());
        let small = d.path().join("small");
        std::fs::write(&small, SAMPLE).unwrap();
        assert_eq!(parse_local_state(&read_bounded(&small).unwrap()).len(), 4);
        assert!(read_bounded(&d.path().join("missing")).is_none());
    }

    #[test]
    fn only_https_links_to_allowed_hosts_open() {
        for ok in [
            "https://x.com/intent/tweet?text=Hi%20there",
            "https://www.linkedin.com/",
            "https://studio.youtube.com/",
            "https://X.COM/intent/tweet",
            "HTTPS://youtube.com",
        ] {
            assert!(allowed_url(ok), "{ok}");
        }
        for bad in [
            "http://x.com/",
            "https://x.com@evil.com/",
            "https://evil.com/?https://x.com",
            "https://x.com.evil.com/",
            "https://evilx.com/",
            "https://x.com:8443/",
            "https://user:pw@x.com/",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "x.com",
            "https://x.com/\nhttps://evil.com",
            "https://x.com/ a",
            "https://x.com\\@evil.com/",
            "https://x%2ecom/",
            "",
        ] {
            assert!(!allowed_url(bad), "{bad:?}");
        }
    }

    #[test]
    fn profile_dirs_must_look_like_chromium_folders() {
        for ok in ["Default", "Profile 1", "Guest Profile"] {
            assert!(plausible_dir(ok));
        }
        for bad in [
            "Default; rm -rf ~",
            "../Default",
            "Profile 1\n",
            "",
            "a/b",
            "$(id)",
            &"a".repeat(65),
        ] {
            assert!(!plausible_dir(bad), "{bad:?}");
        }
        // A folder that is not in the list is refused before anything runs.
        let d = tempfile::tempdir().unwrap();
        assert_eq!(
            open(d.path(), "https://x.com/", Some("com.example.Fake"), None).unwrap_err(),
            OpenError::UnknownBrowser
        );
        // Chrome may be installed here, but this home has no Local State, so
        // no folder is known.
        assert!(matches!(
            open(
                d.path(),
                "https://x.com/",
                Some("com.google.Chrome"),
                Some("Default")
            ),
            Err(OpenError::UnknownProfile | OpenError::UnknownBrowser)
        ));
        assert_eq!(
            open(d.path(), "https://x.com/", None, Some("Default")).unwrap_err(),
            OpenError::UnknownProfile
        );
        assert_eq!(
            open(d.path(), "https://evil.com/", None, None).unwrap_err(),
            OpenError::NotAllowed
        );
        assert!(profiles(d.path(), "com.apple.Safari").is_empty());
        assert!(
            profiles(d.path(), "com.google.Chrome").is_empty(),
            "no Local State, no profiles"
        );
    }

    #[test]
    fn open_arguments_per_browser_kind() {
        let url = "https://x.com/intent/tweet?text=a%20b%26c";
        assert_eq!(open_args(None, None, url), vec![url]);
        assert_eq!(
            open_args(Some("/Applications/Safari.app"), None, url),
            vec!["-a", "/Applications/Safari.app", url]
        );
        assert_eq!(
            open_args(
                Some("/Applications/Google Chrome.app"),
                Some("Profile 1"),
                url
            ),
            vec![
                "-na",
                "/Applications/Google Chrome.app",
                "--args",
                "--profile-directory=Profile 1",
                url
            ]
        );
        // The url is always exactly one argument, the last.
        for a in [
            open_args(None, None, url),
            open_args(Some("/A.app"), None, url),
            open_args(Some("/A.app"), Some("Default"), url),
        ] {
            assert_eq!(a.last().map(String::as_str), Some(url));
            assert_eq!(a.iter().filter(|x| x.contains("x.com")).count(), 1);
        }
    }

    #[test]
    fn fallback_to_the_default_browser_is_reported() {
        let mut calls: Vec<Vec<String>> = Vec::new();
        let r = open_with(
            Some("/Gone.app"),
            Some("Default"),
            "https://x.com/",
            &mut |a| {
                calls.push(a.to_vec());
                a.len() == 1
            },
        );
        assert_eq!(r, Ok(Opened { fallback: true }));
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1], vec!["https://x.com/"]);
        assert_eq!(
            open_with(None, None, "https://x.com/", &mut |_| true),
            Ok(Opened { fallback: false })
        );
        assert_eq!(
            open_with(None, None, "https://x.com/", &mut |_| false),
            Err(OpenError::OpenFailed)
        );
        assert_eq!(
            open_with(Some("/A.app"), None, "https://x.com/", &mut |_| false),
            Err(OpenError::OpenFailed)
        );
    }

    /// Manual: opens a harmless page once per real Chrome profile. Prints
    /// only folder names and results. Run with
    /// `ROKK_OPEN_PROFILES=1 cargo test --lib rokk_record::browsers -- --ignored --nocapture`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn open_once_per_real_chrome_profile() {
        if std::env::var("ROKK_OPEN_PROFILES").is_err() {
            return;
        }
        let h = dirs::home_dir().unwrap();
        let found = list(&h);
        println!(
            "browsers: {:?}",
            found.iter().map(|b| b.id.as_str()).collect::<Vec<_>>()
        );
        for p in profiles(&h, "com.google.Chrome") {
            let r = open(
                &h,
                "https://www.youtube.com/",
                Some("com.google.Chrome"),
                Some(&p.dir),
            );
            println!("profile dir {:?}: {:?}", p.dir, r);
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    }
}
