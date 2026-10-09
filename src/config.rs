use std::{collections::HashMap, path::Path};

use anyhow::{Context, bail, ensure};
use serde::{Deserialize, Deserializer};

#[derive(Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub base_url: Option<String>,
    pub key_length: usize,
    pub max_length: usize,
    pub key_generator: KeyGenerator,
    pub static_max_age: u64,
    pub logging: Logging,
    pub rate_limits: Option<RateLimits>,
    pub storage: StorageConfig,
    pub documents: HashMap<String, String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 7777,
            base_url: None,
            key_length: 10,
            max_length: 400000,
            key_generator: KeyGenerator::Random {
                keyspace: default_keyspace(),
            },
            static_max_age: 86400,
            logging: Logging::default(),
            rate_limits: None,
            storage: StorageConfig::File {
                path: default_path(),
                expire: 0,
            },
            documents: HashMap::new(),
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum KeyGenerator {
    Phonetic,
    Random {
        #[serde(default = "default_keyspace")]
        keyspace: String,
    },
    Dictionary {
        path: String,
    },
}

fn default_keyspace() -> String {
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".into()
}
fn default_path() -> String {
    "./data".into()
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum StorageConfig {
    File {
        #[serde(default = "default_path")]
        path: String,
        #[serde(default, deserialize_with = "expiration")]
        expire: u64,
    },
    Redis {
        #[serde(default, deserialize_with = "expiration")]
        expire: u64,
        #[serde(default, rename = "redisOptions")]
        options: RedisOptions,
    },
}

fn expiration<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    if value == serde_json::Value::Bool(false) {
        return Ok(0);
    }
    value
        .as_u64()
        .ok_or_else(|| serde::de::Error::custom("expire must be a non-negative integer or false"))
}

#[derive(Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RedisOptions {
    pub host: String,
    pub port: u16,
    pub db: i64,
    pub username: Option<String>,
    pub password: Option<String>,
}
impl Default for RedisOptions {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 6379,
            db: 0,
            username: None,
            password: None,
        }
    }
}

#[derive(Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Logging {
    pub level: String,
}
impl Default for Logging {
    fn default() -> Self {
        Self {
            level: "info".into(),
        }
    }
}

#[derive(Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct RateLimits {
    pub window_ms: u64,
    pub max: u64,
    pub message: String,
}
impl Default for RateLimits {
    fn default() -> Self {
        Self {
            window_ms: 60000,
            max: 5,
            message: "Too many requests, please try again later.".into(),
        }
    }
}

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        let path = std::env::var("CONFIG").unwrap_or_else(|_| "config.json".into());
        if !Path::new(&path).exists() && path == "config.json" {
            if Path::new("config.js").exists() {
                bail!(
                    "config.js must be converted first: node scripts/convert-config.js config.js config.json"
                );
            }
            std::fs::copy("example.config.json", &path)?;
        }
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path)?).context("Invalid JSON configuration")?;
        // The legacy loader supplied these tags when option objects omitted them.
        for (field, kind) in [("storage", "file"), ("keyGenerator", "random")] {
            if let Some(options) = value
                .get_mut(field)
                .and_then(serde_json::Value::as_object_mut)
            {
                options
                    .entry("type")
                    .or_insert_with(|| serde_json::Value::String(kind.into()));
            }
        }
        let mut config: Self = serde_json::from_value(value)
            .context("Invalid configuration (Rust supports file and Redis storage)")?;
        if let Ok(host) = std::env::var("HOST") {
            config.host = host;
        }
        if let Ok(port) = std::env::var("PORT") {
            config.port = port.parse().context("Invalid PORT")?;
        }
        if config.key_length == 0 {
            config.key_length = 10;
        }
        if let KeyGenerator::Random { keyspace } = &mut config.key_generator {
            if keyspace.is_empty() {
                *keyspace = default_keyspace();
            }
            ensure!(
                !keyspace.contains(['/', '.', '%', '?', '#']),
                "keyspace contains URL delimiters"
            );
        }
        if let Some(rate) = &config.rate_limits {
            ensure!(rate.window_ms > 0, "windowMs must be positive");
        }
        Ok(config)
    }
}
