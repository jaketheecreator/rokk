pub mod modules;

#[cfg(target_os = "macos")]
use modules::app_menu;
use modules::{
    agent, control, fs, git, history, lsp, net, pty, secrets, shell, vibrancy, workspace,
};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri::WindowEvent;
use tauri_plugin_window_state::StateFlags;

/// Drained on first read so HMR / re-mounts can't replay the launch dir.
#[derive(Default)]
struct LaunchDir(Mutex<Option<String>>);

/// Drained on first read so HMR / re-mounts can't replay the launch files.
#[derive(Default)]
struct LaunchFiles(Mutex<Vec<String>>);

#[tauri::command]
fn get_launch_dir(state: State<'_, LaunchDir>) -> Option<String> {
    state.0.lock().expect("LaunchDir mutex poisoned").take()
}

#[tauri::command]
fn get_launch_files(state: State<'_, LaunchFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().expect("LaunchFiles mutex poisoned"))
}

enum LaunchEntry {
    Dir(PathBuf),
    File(PathBuf),
}

#[derive(Default, Debug, PartialEq)]
struct LaunchTarget {
    dir: Option<String>,
    files: Vec<String>,
}

/// First dir arg (else the first file's parent) becomes the workspace; every
/// file arg is opened. Kept free of fs/env access so it stays unit-testable.
fn resolve_launch_target(entries: Vec<LaunchEntry>) -> LaunchTarget {
    let mut dir = None;
    let mut files = Vec::new();
    for entry in entries {
        match entry {
            LaunchEntry::Dir(path) => {
                if dir.is_none() {
                    dir = Some(fs::to_canon(&path));
                }
            }
            LaunchEntry::File(path) => {
                if dir.is_none() {
                    dir = path.parent().map(fs::to_canon);
                }
                files.push(fs::to_canon(&path));
            }
        }
    }
    LaunchTarget { dir, files }
}

fn parse_launch_target() -> LaunchTarget {
    let entries = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| std::fs::canonicalize(arg).ok())
        .filter_map(|path| {
            let meta = std::fs::metadata(&path).ok()?;
            Some(if meta.is_dir() {
                LaunchEntry::Dir(path)
            } else {
                LaunchEntry::File(path)
            })
        })
        .collect();
    resolve_launch_target(entries)
}

const fn settings_always_on_top(is_macos: bool) -> bool {
    !is_macos
}

/// Graphite window color (`--rk-window` in src/styles/rokk-surfaces.css), so
/// Settings never shows a white frame before its page paints.
const fn settings_background(dark: bool) -> (u8, u8, u8) {
    if dark {
        (0x0f, 0x0f, 0x0e)
    } else {
        (0xe7, 0xe4, 0xdd)
    }
}

const SETTINGS_SIZE: (f64, f64) = (960.0, 680.0);
const SETTINGS_MIN_SIZE: (f64, f64) = (760.0, 520.0);

/// Fits a (saved or default) Settings size inside 90% of the work area while
/// keeping the minimum, unless the screen itself is smaller than that.
fn clamp_settings_size(size: (u32, u32), work: (u32, u32), min: (u32, u32)) -> (u32, u32) {
    let fit = |value: u32, area: u32, floor: u32| {
        let max = (u64::from(area) * 9 / 10) as u32;
        value.max(floor.min(max)).min(max)
    };
    (fit(size.0, work.0, min.0), fit(size.1, work.1, min.1))
}

#[tauri::command]
async fn open_settings_window(
    app: tauri::AppHandle,
    tab: Option<String>,
    dark: Option<bool>,
) -> Result<(), String> {
    let url_path = match tab.as_deref() {
        Some(t) if !t.is_empty() => format!("settings.html?tab={}", t),
        _ => "settings.html".to_string(),
    };

    if let Some(window) = app.get_webview_window("settings") {
        #[cfg(not(target_os = "macos"))]
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(t) = tab.as_deref().filter(|s| !s.is_empty()) {
            // emit() serializes via JSON — no string-escape footgun, unlike
            // eval() with format!(). Frontend listens via Tauri event API.
            let _ = window.emit("terax:settings-tab", t);
        }
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(SETTINGS_SIZE.0, SETTINGS_SIZE.1)
        .min_inner_size(SETTINGS_MIN_SIZE.0, SETTINGS_MIN_SIZE.1)
        .resizable(true)
        .visible(false)
        .always_on_top(settings_always_on_top(cfg!(target_os = "macos")));

    // A normal-level child stays above Terax but recedes with the app on macOS.
    // Never combine the macOS parent with always_on_top; that breaks WebView
    // compositing and can hide Settings behind the main window (#33, #957).
    let builder = if let Some(main) = app.get_webview_window("main") {
        builder.parent(&main).map_err(|e| e.to_string())?
    } else {
        builder
    };

    // The mode the main window resolved (sent by the frontend), else the
    // main window's system theme.
    #[cfg(target_os = "macos")]
    let builder = {
        let dark = dark.unwrap_or_else(|| {
            app.get_webview_window("main")
                .and_then(|main| main.theme().ok())
                .is_none_or(|theme| theme == tauri::Theme::Dark)
        });
        let (r, g, b) = settings_background(dark);
        builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .background_color(tauri::window::Color(r, g, b, 255))
    };
    #[cfg(not(target_os = "macos"))]
    let _ = dark;

    // On Linux/Windows we render our own titlebar, so drop native chrome
    // and make the window transparent.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true);

    let window = builder.build().map_err(|e| e.to_string())?;

    // Some Linux compositors (GNOME/Mutter with CSD-by-default) ignore the
    // builder-time decorations flag — re-assert it after realize.
    #[cfg(target_os = "linux")]
    {
        let _ = window.set_decorations(false);
    }

    // Settings is denylisted in the window-state plugin, so it always opens at
    // the default size; keep that inside 90% of the monitor work area.
    let monitor = app
        .get_webview_window("main")
        .and_then(|main| main.current_monitor().ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten());
    if let (Some(monitor), Ok(size)) = (monitor, window.inner_size()) {
        let work = monitor.work_area().size;
        let scale = monitor.scale_factor();
        let min = (
            (SETTINGS_MIN_SIZE.0 * scale).round() as u32,
            (SETTINGS_MIN_SIZE.1 * scale).round() as u32,
        );
        let fitted =
            clamp_settings_size((size.width, size.height), (work.width, work.height), min);
        if fitted != (size.width, size.height) {
            let _ = window.set_size(tauri::PhysicalSize::new(fitted.0, fitted.1));
        }
    }

    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(main_pos), Ok(main_size), Ok(settings_size)) = (
            main.outer_position(),
            main.outer_size(),
            window.outer_size(),
        ) {
            let x = main_pos.x
                + ((main_size.width as i32).saturating_sub(settings_size.width as i32)) / 2;
            let y = main_pos.y
                + ((main_size.height as i32).saturating_sub(settings_size.height as i32)) / 2;
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        } else {
            let _ = window.center();
        }
    } else {
        let _ = window.center();
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(unix)]
    if std::env::args().nth(1).as_deref() == Some(modules::rokk_guard::SUBCOMMAND) {
        modules::rokk_guard::run_hook();
    }
    #[cfg(windows)]
    {
        let args: Vec<String> = std::env::args().collect();
        if args.get(1).map(String::as_str) == Some("__terax_notify") {
            if let (Some(agent), Some(event)) = (args.get(2), args.get(3)) {
                agent::emit_conout_marker(agent, event);
            }
            use std::io::Write;
            let mut out = std::io::stdout();
            let _ = out.write_all(b"{}");
            let _ = out.flush();
            std::process::exit(0);
        }
    }

    modules::runtime::install();

    let launch = parse_launch_target();
    let cli_dir = launch.dir.clone();
    workspace::init_launch_cwd(cli_dir.as_deref());
    let control_state = control::ControlState::default();
    let control_for_setup = control_state.clone();

    let builder = tauri::Builder::default();
    let builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(app_menu::build)
        .on_menu_event(app_menu::handle_event);
    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Skip restoring VISIBLE — frontend calls window.show() after first
        // paint so the user never sees a transparent window-shadow flash on
        // Windows/Linux.
        .plugin(
            // Settings always opens at its default size, centered over main.
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .with_denylist(&["settings"])
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        // One async scheme multiplexes every terminal's output; see pty/hub.rs.
        .register_asynchronous_uri_scheme_protocol("terax-pty", pty::stream_protocol)
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(state) = webview.try_state::<net::AiStreamState>() {
                    state.cancel_window(webview.window().label());
                }
                if let Some(state) = webview.try_state::<pty::PtyState>() {
                    state.reset_webview(webview.label());
                }
            }
        })
        .setup(move |_app| {
            #[cfg(feature = "bench")]
            modules::bench::guard(_app.handle())?;
            #[cfg(target_os = "macos")]
            modules::window_presentation::macos::install(_app.handle());
            modules::rokk_guard::refresh_app_path();
            if let Err(error) = control::start(_app.handle().clone(), control_for_setup.clone()) {
                log::warn!("could not start Terax control server: {error}");
            }
            #[cfg(target_os = "macos")]
            if let Some(main) = _app.get_webview_window("main") {
                let handle = _app.handle().clone();
                main.on_window_event(move |event| {
                    // CloseRequested can be cancelled by the frontend guard.
                    if matches!(event, WindowEvent::Destroyed) {
                        if let Some(settings) = handle.get_webview_window("settings") {
                            let _ = settings.destroy();
                        }
                    }
                });
            }
            Ok(())
        })
        .manage(pty::PtyState::default())
        .manage(net::AiStreamState::default())
        .manage(modules::ai_sessions::SessionFilesState::default())
        .manage(modules::window_presentation::WindowPresentationState::default())
        .manage(control_state)
        .manage(shell::ShellState::default())
        .manage(secrets::SecretsState::default())
        .manage(fs::watch::FsWatchState::default())
        .manage(history::HistoryState::default())
        .manage(lsp::LspState::default())
        .manage(fs::supersede::Supersede::default())
        .manage(fs::index::FileIndexState::default())
        .manage({
            let registry = workspace::WorkspaceRegistry::default();
            workspace::bootstrap_registry(&registry);
            if let Some(ref launch_dir) = cli_dir {
                let _ = registry.authorize(launch_dir);
            }
            registry
        })
        .manage(LaunchDir(Mutex::new(cli_dir)))
        .manage(LaunchFiles(Mutex::new(launch.files)))
        .invoke_handler(tauri::generate_handler![
            pty::pty_open,
            pty::pty_write,
            pty::pty_stream_open,
            pty::pty_set_presentation,
            pty::pty_diagnostics,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_close_all,
            pty::pty_has_foreground_process,
            pty::pty_has_foreground_job,
            pty::pty_shell_name,
            pty::pty_list_shells,
            fs::tree::list_subdirs,
            fs::tree::fs_read_dir,
            fs::file::fs_read_file,
            fs::file::fs_write_file,
            fs::file::fs_stat,
            fs::file::fs_canonicalize,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_rename,
            fs::mutate::fs_move,
            fs::mutate::fs_delete,
            fs::mutate::fs_delete_batch,
            fs::copy::fs_copy,
            fs::clipboard::fs_clipboard_paths,
            fs::watch::fs_watch_add,
            fs::watch::fs_watch_remove,
            lsp::lsp_detect,
            lsp::lsp_host_pid,
            lsp::lsp_resolve_root,
            lsp::lsp_spawn,
            lsp::lsp_send,
            lsp::lsp_kill,
            fs::search::fs_search,
            fs::search::fs_list_files,
            fs::grep::fs_grep,
            fs::grep::fs_grep_interactive,
            fs::grep::fs_glob,
            git::commands::git_resolve_repo,
            git::commands::git_panel_snapshot,
            git::commands::git_status,
            git::commands::git_diff,
            git::commands::git_diff_content,
            git::commands::git_stage,
            git::commands::git_unstage,
            git::commands::git_discard,
            git::commands::git_commit,
            git::commands::git_fetch,
            git::commands::git_pull_ff_only,
            git::commands::git_push,
            git::commands::git_log,
            git::commands::git_show_commit,
            git::commands::git_commit_files,
            git::commands::git_commit_file_diff,
            git::commands::git_remote_url,
            git::commands::git_list_branches,
            git::commands::git_checkout_branch,
            shell::shell_run_command,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::shell_bg_spawn,
            shell::shell_bg_logs,
            shell::shell_bg_kill,
            shell::shell_bg_list,
            workspace::wsl_list_distros,
            workspace::wsl_default_distro,
            workspace::ipc::wsl_home,
            workspace::workspace_authorize,
            workspace::workspace_current_dir,
            control::control_frontend_ready,
            control::control_respond,
            get_launch_dir,
            get_launch_files,
            open_settings_window,
            agent::agent_enable_hooks,
            agent::agent_hooks_status,
            modules::rokk_guard::guard_status,
            modules::rokk_guard::guard_enable,
            modules::rokk_guard::guard_disable,
            modules::rokk_guard::guard_remove_all,
            modules::rokk_guard::guard_set_sensitivity,
            modules::rokk_guard::guard_set_ship_it,
            modules::rokk_guard::guard_score,
            modules::rokk_guard::guard_stats,
            modules::rokk_meter::meter_find_session,
            modules::rokk_meter::meter_read,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_get_all,
            net::lm_ping,
            net::ai_http_stream,
            net::ai_http_cancel,
            net::ai_http_ack,
            modules::ai_sessions::ai_session_load,
            modules::ai_sessions::ai_session_save,
            modules::ai_sessions::ai_session_delete,
            modules::ai_sessions::ai_session_finish_migration,
            modules::ai_sessions::ai_session_prune_backup,
            history::history_suggest,
            history::history_commands,
            history::history_record,
            history::history_list,
            vibrancy::window_backdrop_kind,
            vibrancy::window_set_backdrop,
            modules::window_presentation::window_presentation_state,
            #[cfg(feature = "bench")]
            modules::bench::bench_config,
            #[cfg(feature = "bench")]
            modules::bench::bench_window,
            #[cfg(feature = "bench")]
            modules::bench::bench_exit,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::Destroyed,
                    ..
                } => {
                    if let Some(state) = app.try_state::<net::AiStreamState>() {
                        state.cancel_window(&label);
                    }
                    if let Some(state) = app.try_state::<pty::PtyState>() {
                        state.destroy_webview(&label);
                    }
                }
                // Servers exit on stdin EOF, but destructors are not guaranteed
                // on process exit; kill explicitly.
                tauri::RunEvent::Exit => {
                    #[cfg(target_os = "macos")]
                    modules::window_presentation::macos::uninstall();
                    if let Some(state) = app.try_state::<lsp::LspState>() {
                        state.kill_all();
                    }
                    if let Some(state) = app.try_state::<control::ControlState>() {
                        state.shutdown();
                    }
                }
                // macOS delivers "Open With" files here, not as argv (cold and
                // warm start, several at once). Seed the drain-once state and
                // emit; canonicalize so the /tmp -> /private/tmp symlink can't
                // defeat openFileTab's path dedupe against a CLI launch.
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    let entries = urls
                        .iter()
                        .filter_map(|u| u.to_file_path().ok())
                        .filter_map(|p| std::fs::canonicalize(p).ok())
                        .filter(|p| p.is_file())
                        .map(LaunchEntry::File)
                        .collect();
                    let target = resolve_launch_target(entries);
                    if target.files.is_empty() {
                        return;
                    }
                    if let Some(dir) = &target.dir {
                        if let Some(registry) = app.try_state::<workspace::WorkspaceRegistry>() {
                            let _ = registry.authorize(dir);
                        }
                        if let Some(state) = app.try_state::<LaunchDir>() {
                            *state.0.lock().expect("LaunchDir mutex poisoned") = Some(dir.clone());
                        }
                    }
                    if let Some(state) = app.try_state::<LaunchFiles>() {
                        *state.0.lock().expect("LaunchFiles mutex poisoned") = target.files.clone();
                    }
                    let _ = app.emit("terax:open-file", target.files);
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod launch_target_tests {
    use super::{
        clamp_settings_size, resolve_launch_target, settings_always_on_top, settings_background,
        LaunchEntry, LaunchTarget,
    };
    use std::path::PathBuf;

    #[test]
    fn no_entries_resolves_to_empty() {
        assert_eq!(resolve_launch_target(vec![]), LaunchTarget::default());
    }

    #[test]
    fn dir_arg_sets_workspace_and_opens_nothing() {
        let out = resolve_launch_target(vec![LaunchEntry::Dir(PathBuf::from("/home/u/proj"))]);
        assert_eq!(out.dir.as_deref(), Some("/home/u/proj"));
        assert!(out.files.is_empty());
    }

    #[test]
    fn file_arg_opens_file_and_uses_parent_as_workspace() {
        let out = resolve_launch_target(vec![LaunchEntry::File(PathBuf::from(
            "/home/u/proj/main.rs",
        ))]);
        assert_eq!(out.dir.as_deref(), Some("/home/u/proj"));
        assert_eq!(out.files, vec!["/home/u/proj/main.rs".to_string()]);
    }

    #[test]
    fn multiple_files_all_open_and_first_parent_wins() {
        let out = resolve_launch_target(vec![
            LaunchEntry::File(PathBuf::from("/a/one.txt")),
            LaunchEntry::File(PathBuf::from("/b/two.txt")),
        ]);
        assert_eq!(out.dir.as_deref(), Some("/a"));
        assert_eq!(
            out.files,
            vec!["/a/one.txt".to_string(), "/b/two.txt".to_string()]
        );
    }

    #[test]
    fn explicit_dir_takes_precedence_over_file_parent() {
        let out = resolve_launch_target(vec![
            LaunchEntry::Dir(PathBuf::from("/workspace")),
            LaunchEntry::File(PathBuf::from("/other/x.rs")),
        ]);
        assert_eq!(out.dir.as_deref(), Some("/workspace"));
        assert_eq!(out.files, vec!["/other/x.rs".to_string()]);
    }

    #[test]
    fn settings_float_only_outside_macos() {
        assert!(!settings_always_on_top(true));
        assert!(settings_always_on_top(false));
    }

    #[test]
    fn settings_size_keeps_a_size_that_fits() {
        assert_eq!(clamp_settings_size((1920, 1360), (3024, 1890), (1520, 1040)), (1920, 1360));
    }

    #[test]
    fn settings_size_clamps_to_ninety_percent_of_the_work_area() {
        assert_eq!(clamp_settings_size((4000, 3000), (3024, 1890), (1520, 1040)), (2721, 1701));
    }

    #[test]
    fn settings_size_raises_to_the_minimum() {
        assert_eq!(clamp_settings_size((300, 200), (3024, 1890), (1520, 1040)), (1520, 1040));
    }

    #[test]
    fn settings_size_screen_smaller_than_minimum_wins() {
        assert_eq!(clamp_settings_size((1520, 1040), (1280, 800), (1520, 1040)), (1152, 720));
    }

    #[test]
    fn settings_background_is_the_graphite_window_color() {
        assert_eq!(settings_background(true), (0x0f, 0x0f, 0x0e));
        assert_eq!(settings_background(false), (0xe7, 0xe4, 0xdd));
    }
}
