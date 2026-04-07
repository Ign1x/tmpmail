use std::{env, sync::Arc, thread};

use anyhow::{Context, Result};
use reqwest::Url;
use sqlx::{Connection, Executor, PgConnection};
use tokio::runtime::Builder;
use uuid::Uuid;

use crate::{config::Config, state::AppState};

#[derive(Clone, Debug)]
pub(crate) struct TestDatabase {
    url: String,
    _cleanup: Arc<TestDatabaseCleanup>,
}

#[derive(Debug)]
struct TestDatabaseCleanup {
    admin_database_url: String,
    database_name: String,
}

impl TestDatabase {
    pub(crate) async fn new(label: &str) -> Self {
        let admin_database_url = test_database_base_url();
        let database_name = format!(
            "tmpmail_test_{}_{}",
            sanitize_database_label(label),
            Uuid::new_v4().simple()
        );
        let url = replace_database_in_url(&admin_database_url, &database_name)
            .expect("build isolated test database url");

        create_database(&admin_database_url, &database_name)
            .await
            .expect("create isolated test database");
        initialize_database(&url)
            .await
            .expect("initialize isolated test database");

        Self {
            url,
            _cleanup: Arc::new(TestDatabaseCleanup {
                admin_database_url,
                database_name,
            }),
        }
    }

    pub(crate) fn url(&self) -> &str {
        &self.url
    }
}

impl Drop for TestDatabaseCleanup {
    fn drop(&mut self) {
        let admin_database_url = self.admin_database_url.clone();
        let database_name = self.database_name.clone();

        let drop_future = async move {
            if let Err(error) = drop_database(&admin_database_url, &database_name).await {
                eprintln!("failed to drop isolated test database {database_name}: {error}");
            }
        };

        let _ = thread::spawn(move || {
            Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("build test database cleanup runtime")
                .block_on(drop_future);
        });
    }
}

pub(crate) async fn attach_test_database(config: Config, label: &str) -> (Config, TestDatabase) {
    let database = TestDatabase::new(label).await;
    let config = Config {
        database_url: database.url().to_owned(),
        ..config
    };

    (config, database)
}

pub(crate) async fn build_test_state(config: Config, label: &str) -> AppState {
    let (config, database) = attach_test_database(config, label).await;
    AppState::new(config)
        .await
        .expect("build test state")
        .with_test_database(database)
}

fn test_database_base_url() -> String {
    env::var("TMPMAIL_TEST_DATABASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            env::var("TMPMAIL_DATABASE_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .expect("TMPMAIL_TEST_DATABASE_URL or TMPMAIL_DATABASE_URL must be set for backend tests")
}

fn sanitize_database_label(label: &str) -> String {
    let filtered = label
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(16)
        .collect::<String>()
        .to_ascii_lowercase();
    if filtered.is_empty() {
        "db".to_owned()
    } else {
        filtered
    }
}

fn replace_database_in_url(base_url: &str, database_name: &str) -> Result<String> {
    let mut url = Url::parse(base_url)
        .with_context(|| format!("parse postgres url for isolated test database: {base_url}"))?;
    url.set_path(&format!("/{database_name}"));
    Ok(url.to_string())
}

async fn create_database(admin_database_url: &str, database_name: &str) -> Result<()> {
    let mut connection = PgConnection::connect(admin_database_url)
        .await
        .with_context(|| "connect postgres admin database for test setup")?;

    connection
        .execute(format!("CREATE DATABASE \"{database_name}\"").as_str())
        .await
        .with_context(|| format!("create isolated test database {database_name}"))?;

    connection.close().await.ok();
    Ok(())
}

async fn initialize_database(database_url: &str) -> Result<()> {
    let connection = PgConnection::connect(database_url)
        .await
        .with_context(|| "connect isolated test database for migrations")?;
    connection.close().await.ok();

    let pool = sqlx::PgPool::connect(database_url)
        .await
        .with_context(|| "connect isolated test database pool for migrations")?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .with_context(|| "run migrations for isolated test database")?;
    pool.close().await;

    Ok(())
}

async fn drop_database(admin_database_url: &str, database_name: &str) -> Result<()> {
    let mut connection = PgConnection::connect(admin_database_url)
        .await
        .with_context(|| "connect postgres admin database for test cleanup")?;

    sqlx::query(
        r#"
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
        "#,
    )
    .bind(database_name)
    .execute(&mut connection)
    .await
    .with_context(|| format!("terminate test database connections for {database_name}"))?;

    connection
        .execute(format!("DROP DATABASE IF EXISTS \"{database_name}\"").as_str())
        .await
        .with_context(|| format!("drop isolated test database {database_name}"))?;

    connection.close().await.ok();
    Ok(())
}
