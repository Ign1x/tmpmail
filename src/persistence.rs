use std::{
    env,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    process,
};

use uuid::Uuid;

pub fn write_file_atomically(path: &Path, contents: &str) -> io::Result<()> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)?;
    }

    let temp_path = create_temp_path(path);
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)?;
    let result = (|| {
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp_path, path)?;
        sync_parent_directory(path)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    result
}

fn create_temp_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("state");
    let unique = format!(
        ".{file_name}.{}.{}.tmp",
        process::id(),
        Uuid::new_v4().simple()
    );

    match path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        Some(parent) => parent.join(unique),
        None => env::temp_dir().join(unique),
    }
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> io::Result<()> {
    let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    else {
        return Ok(());
    };

    File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{env, fs};

    use uuid::Uuid;

    use super::write_file_atomically;

    fn temp_file_path(name: &str) -> std::path::PathBuf {
        env::temp_dir().join(format!("tmpmail-persist-{name}-{}.json", Uuid::new_v4()))
    }

    #[test]
    fn atomic_write_replaces_existing_content_without_temp_artifacts() {
        let path = temp_file_path("replace");
        fs::write(&path, "old").expect("seed file");

        write_file_atomically(&path, "new").expect("replace file");

        let parent = path.parent().expect("temp dir");
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .expect("file name");
        let temp_prefix = format!(".{file_name}.");
        let siblings = fs::read_dir(parent)
            .expect("read dir")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(fs::read_to_string(&path).expect("read updated file"), "new");
        assert!(
            siblings
                .iter()
                .all(|entry| entry == file_name || !entry.starts_with(&temp_prefix))
        );

        let _ = fs::remove_file(path);
    }
}
