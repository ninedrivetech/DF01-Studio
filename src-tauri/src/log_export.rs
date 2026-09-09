use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use tauri::Manager;

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .download_dir()
        .map_err(|_| "无法获取下载目录，请检查系统设置后重试".into())
}

#[tauri::command]
pub fn log_export_directory(app: tauri::AppHandle) -> Result<String, String> {
    directory(&app).map(|path| path.to_string_lossy().into_owned())
}

fn valid_filename(filename: &str) -> bool {
    let Some(stem) = filename.strip_suffix(".log") else {
        return false;
    };
    let first = stem
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let reserved = matches!(first.as_str(), "con" | "prn" | "aux" | "nul")
        || ["com", "lpt"].iter().any(|prefix| {
            first
                .strip_prefix(prefix)
                .is_some_and(|n| n.len() == 1 && matches!(n.as_bytes()[0], b'1'..=b'9'))
        });
    !stem.is_empty()
        && stem.chars().count() <= 80
        && !stem.ends_with(['.', ' '])
        && !reserved
        && !stem
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
}

fn write_log(directory: &Path, filename: &str, content: &str) -> Result<PathBuf, String> {
    if !valid_filename(filename) {
        return Err("文件名无效，请使用不含路径的 .log 文件名".into());
    }
    if content.len() > 8 * 1024 * 1024 {
        return Err("日志超过 8 MB，请缩小筛选范围后重试".into());
    }
    fs::create_dir_all(directory).map_err(|_| "无法访问下载目录，请检查文件夹权限".to_string())?;
    let stem = filename.strip_suffix(".log").unwrap();
    for index in 0..1000 {
        let path = directory.join(if index == 0 {
            filename.to_owned()
        } else {
            format!("{stem} ({index}).log")
        });
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("无法保存日志，请检查下载目录权限和磁盘空间后重试".into()),
        };
        if file
            .write_all(content.as_bytes())
            .and_then(|()| file.sync_all())
            .is_err()
        {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err("日志写入失败，请检查磁盘空间后重试".into());
        }
        return Ok(path);
    }
    Err("同名日志过多，请更换文件名后重试".into())
}

#[tauri::command]
pub async fn save_log_export(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<String, String> {
    let directory = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || write_log(&directory, &filename, &content))
        .await
        .map_err(|_| "日志保存任务未完成，请重试".to_string())?
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filenames_cannot_escape_downloads_or_use_device_names() {
        for name in [
            "../test.log",
            "C:\\test.log",
            "a/b.log",
            "a:stream.log",
            "CON.log",
            "aux.extra.log",
            "LPT1.log",
            "COM9.log",
            "a.log.exe",
            ".log",
            "a .log",
            "a\n.log",
        ] {
            assert!(!valid_filename(name), "{name}");
        }
        assert!(valid_filename("通信记录-01.log"));
    }
    #[test]
    fn repeated_exports_preserve_existing_files_and_utf8() {
        let directory = std::env::temp_dir().join(format!(
            "df01-log-export-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let first = write_log(&directory, "设备.log", "第一份\r\n").unwrap();
        let second = write_log(&directory, "设备.log", "第二份\r\n").unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read_to_string(first).unwrap(), "第一份\r\n");
        assert_eq!(fs::read_to_string(second).unwrap(), "第二份\r\n");
        assert!(write_log(&directory, "large.log", &"a".repeat(8 * 1024 * 1024 + 1)).is_err());
        assert!(!directory.join("large.log").exists());
        fs::remove_dir_all(directory).unwrap();
    }
}
