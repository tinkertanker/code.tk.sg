use std::path::PathBuf;

use anyhow::Context;
use redis::aio::ConnectionManager;
use tokio::io::AsyncWriteExt;

use crate::config::StorageConfig;

pub enum Store {
    File(PathBuf),
    Redis {
        connection: ConnectionManager,
        expire: u64,
    },
}

impl Store {
    pub async fn new(config: &StorageConfig) -> anyhow::Result<Self> {
        match config {
            StorageConfig::File { path, expire } => {
                let path = PathBuf::from(path);
                let mut builder = tokio::fs::DirBuilder::new();
                builder.recursive(true);
                #[cfg(unix)]
                builder.mode(0o700);
                builder.create(&path).await?;
                if *expire > 0 {
                    tracing::warn!("File storage does not support expiration");
                }
                Ok(Self::File(path))
            }
            StorageConfig::Redis { options, expire } => {
                let info = redis::ConnectionInfo {
                    addr: redis::ConnectionAddr::Tcp(options.host.clone(), options.port),
                    redis: redis::RedisConnectionInfo {
                        db: options.db,
                        username: options.username.clone(),
                        password: options.password.clone(),
                        ..Default::default()
                    },
                };
                let client = redis::Client::open(info)?;
                let manager_config = redis::aio::ConnectionManagerConfig::new()
                    .set_connection_timeout(std::time::Duration::from_secs(5))
                    .set_response_timeout(std::time::Duration::from_secs(5));
                let connection = ConnectionManager::new_with_config(client, manager_config)
                    .await
                    .context("Cannot connect to Redis")?;
                Ok(Self::Redis {
                    connection,
                    expire: *expire,
                })
            }
        }
    }

    pub async fn get(&self, key: &str, skip_expire: bool) -> anyhow::Result<Option<String>> {
        let data = match self {
            Self::File(path) => {
                match tokio::fs::read(path.join(format!("{:x}", md5::compute(key)))).await {
                    Ok(data) => Some(String::from_utf8_lossy(&data).into_owned()),
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
                    Err(err) => return Err(err.into()),
                }
            }
            Self::Redis { connection, expire } => {
                let mut connection = connection.clone();
                // Read and renew in one transaction, never adding a prefix or changing the DB.
                let mut pipe = redis::pipe();
                pipe.atomic().get(key);
                if !skip_expire && *expire > 0 {
                    pipe.expire(key, *expire as i64).ignore();
                }
                let (data,): (Option<Vec<u8>>,) = pipe.query_async(&mut connection).await?;
                data.map(|data| String::from_utf8_lossy(&data).into_owned())
            }
        };
        Ok(data.filter(|data| !data.is_empty()))
    }

    // Only startup static documents replace existing values. New pastes are insert-only.
    pub async fn set(&self, key: &str, data: &str, static_document: bool) -> anyhow::Result<bool> {
        match self {
            Self::File(path) => {
                let destination = path.join(format!("{:x}", md5::compute(key)));
                let temporary = path.join(format!(
                    ".pending-{}-{}",
                    std::process::id(),
                    rand::random::<u64>()
                ));
                let mut options = tokio::fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                options.mode(0o600);
                let mut file = options.open(&temporary).await?;
                let result = async {
                    file.write_all(data.as_bytes()).await?;
                    file.sync_all().await?;
                    if static_document {
                        tokio::fs::rename(&temporary, &destination).await?;
                        Ok(true)
                    } else {
                        match tokio::fs::hard_link(&temporary, &destination).await {
                            Ok(()) => Ok(true),
                            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                                Ok(false)
                            }
                            Err(err) => Err(err),
                        }
                    }
                }
                .await;
                let _ = tokio::fs::remove_file(&temporary).await;
                Ok(result?)
            }
            Self::Redis { connection, expire } => {
                let mut connection = connection.clone();
                let mut cmd = redis::cmd("SET");
                cmd.arg(key).arg(data);
                if !static_document {
                    cmd.arg("NX");
                    if *expire > 0 {
                        cmd.arg("EX").arg(*expire);
                    }
                }
                let result: Option<String> = cmd.query_async(&mut connection).await?;
                Ok(result.is_some())
            }
        }
    }
}
