fn main() {
    configure_sidecar();
    link_swift_compatibility();
    tauri_build::build()
}

/// The screencapturekit crates (Rokk recording, docs/rokk/RECORD.md) link
/// Swift's static compatibility libraries but only search the full-Xcode
/// toolchain layout (`<developer dir>/Toolchains/XcodeDefault.xctoolchain`).
/// With only the Command Line Tools selected they live next to the active
/// `swiftc` instead, so add that folder, found through `xcrun` at build time.
///
/// Their `rustc-link-arg` rpaths do not reach this package's binaries (link
/// args are not passed on to dependents), so the Swift runtime rpath is set
/// here. `rustc-link-arg` applies to every linked target of this package:
/// the app binary and the lib unit-test binary.
fn link_swift_compatibility() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    println!("cargo:rerun-if-env-changed=DEVELOPER_DIR");
    // The OS Swift runtime (in the dyld shared cache since macOS 12).
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    let Ok(output) = std::process::Command::new("xcrun").args(["--find", "swiftc"]).output() else {
        return;
    };
    if !output.status.success() {
        return;
    }
    let swiftc = std::path::PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    let Some(dir) = swiftc
        .parent()
        .and_then(|bin| bin.parent())
        .map(|usr| usr.join("lib").join("swift").join("macosx"))
    else {
        return;
    };
    if dir.join("libswiftCompatibility56.a").is_file() {
        println!("cargo:rustc-link-search=native={}", dir.display());
    }
    // A toolchain copy of the runtime, only where one exists.
    if dir.join("libswift_Concurrency.dylib").is_file() {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", dir.display());
    }
}

fn configure_sidecar() {
    let Ok(target) = std::env::var("TARGET") else {
        return;
    };
    let extension = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let path = std::path::PathBuf::from("binaries").join(format!("terax-cli-{target}{extension}"));
    let valid =
        std::fs::metadata(&path).is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0);
    if valid {
        return;
    }
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        panic!(
            "release sidecar {} is missing or empty; run pnpm build:cli before packaging",
            path.display()
        );
    }

    let mut config = std::env::var("TAURI_CONFIG")
        .map(|value| serde_json::from_str(&value).expect("parse TAURI_CONFIG"))
        .unwrap_or_else(|_| serde_json::json!({}));
    config["bundle"]["externalBin"] = serde_json::json!([]);
    std::env::set_var(
        "TAURI_CONFIG",
        serde_json::to_string(&config).expect("serialize TAURI_CONFIG"),
    );
}
