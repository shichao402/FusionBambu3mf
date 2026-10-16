use serde::Serialize;
use tauri::Manager;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeStatus {
    source_hash: String,
    installed_hash: String,
    dest: String,
    copied: bool,
    version: String,
}

fn dev_repo_root() -> Option<PathBuf> {
    let current = std::env::current_dir().ok()?;
    let candidates = [
        current.join("../../bridge"),
        current.join("../bridge"),
        current.join("bridge"),
    ];
    for candidate in candidates {
        if candidate.join("FusionBambuBridge.py").exists() {
            return candidate.parent().map(|path| path.to_path_buf());
        }
    }
    None
}

fn packaged_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().resource_dir().ok()?;
    if dir.join("bridge").join("FusionBambuBridge.py").exists() {
        return Some(dir);
    }
    None
}

fn product_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = dev_repo_root() {
        return Ok(dir);
    }
    packaged_root(app).ok_or_else(|| "找不到随安装包附带的 bridge".to_string())
}

fn version_text(root: &Path) -> String {
    let path = root.join("VERSION.json");
    let raw = fs::read_to_string(path).unwrap_or_else(|_| "{\"version\":\"0.1.0\"}".to_string());
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|value| value.get("version").and_then(|item| item.as_str()).map(|item| item.to_string()))
        .unwrap_or_else(|| "0.1.0".to_string())
}

fn addins_dir() -> PathBuf {
    let mut bases = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        bases.push(PathBuf::from(appdata).join("Autodesk"));
    }
    if let Ok(home) = std::env::var("HOME") {
        bases.push(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("Autodesk"),
        );
    }
    for base in &bases {
        for name in ["Autodesk Fusion", "Autodesk Fusion 360"] {
            let dir = base.join(name).join("API").join("AddIns");
            if dir.is_dir() {
                return dir.join("FusionBambuBridge");
            }
        }
    }
    if cfg!(windows) {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        return PathBuf::from(appdata)
            .join("Autodesk")
            .join("Autodesk Fusion")
            .join("API")
            .join("AddIns")
            .join("FusionBambuBridge");
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Autodesk")
        .join("Autodesk Fusion")
        .join("API")
        .join("AddIns")
        .join("FusionBambuBridge")
}

fn collect(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let mut entries = fs::read_dir(dir).map_err(|error| error.to_string())?.filter_map(|entry| entry.ok()).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    let mut directories = Vec::new();
    let mut filenames = Vec::new();
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.path().is_dir() {
            if name != "__pycache__" {
                directories.push(entry.path());
            }
        } else if name != "payload.hash" && !name.ends_with(".pyc") {
            filenames.push(entry.path());
        }
    }
    filenames.sort();
    directories.sort();
    files.extend(filenames);
    for directory in directories {
        collect(&directory, files)?;
    }
    Ok(())
}

fn digest(dir: &Path) -> Result<String, String> {
    let mut files = Vec::new();
    collect(dir, &mut files)?;
    let mut hasher = Sha256::new();
    for path in files {
        let rel = path.strip_prefix(dir).map_err(|error| error.to_string())?;
        let rel = rel.to_string_lossy().replace('\\', "/");
        hasher.update(rel.as_bytes());
        hasher.update([0]);
        hasher.update(fs::read(&path).map_err(|error| error.to_string())?);
        hasher.update([0]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(from).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "__pycache__" || name.ends_with(".pyc") {
            continue;
        }
        let target = to.join(&name);
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn write_manifest_version(dest: &Path, version: &str) -> Result<(), String> {
    let path = dest.join("FusionBambuBridge.manifest");
    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut value: serde_json::Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    if let Some(object) = value.as_object_mut() {
        object.insert("version".to_string(), serde_json::Value::String(version.to_string()));
        object.insert("runOnStartup".to_string(), serde_json::Value::Bool(true));
    }
    fs::write(path, serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?).map_err(|error| error.to_string())
}

#[tauri::command]
fn sync_bridge(app: tauri::AppHandle) -> Result<BridgeStatus, String> {
    let root = product_root(&app)?;
    let source = root.join("bridge");
    let dest = addins_dir();
    let source_hash = digest(&source)?;
    let installed_hash = fs::read_to_string(dest.join("payload.hash")).unwrap_or_default().trim().to_string();
    let version = version_text(&root);
    let copied = installed_hash != source_hash;
    if copied {
        copy_tree(&source, &dest)?;
        fs::write(dest.join("payload.hash"), format!("{source_hash}\n")).map_err(|error| error.to_string())?;
        let manifest = dest.join("FusionBambuBridge.manifest");
        let raw = fs::read_to_string(&manifest).unwrap_or_default();
        if !raw.contains(&format!("\"version\": \"{version}\"")) && !raw.contains(&format!("\"version\":\t\"{version}\"")) {
            write_manifest_version(&dest, &version)?;
        }
    }
    Ok(BridgeStatus {
        source_hash,
        installed_hash: fs::read_to_string(dest.join("payload.hash")).unwrap_or_default().trim().to_string(),
        dest: dest.display().to_string(),
        copied,
        version,
    })
}

#[tauri::command]
fn read_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(target, bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn pick_open() -> Option<String> {
    rfd::FileDialog::new().add_filter("3MF", &["3mf"]).pick_file().map(|path| path.display().to_string())
}

#[tauri::command]
fn pick_save() -> Option<String> {
    rfd::FileDialog::new().add_filter("3MF", &["3mf"]).save_file().map(|path| path.display().to_string())
}

#[tauri::command]
fn pick_dir() -> Option<String> {
    rfd::FileDialog::new().pick_folder().map(|path| path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![sync_bridge, read_bytes, write_bytes, pick_open, pick_save, pick_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
