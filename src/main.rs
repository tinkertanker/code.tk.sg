mod config;
mod preview;
mod store;

use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::ensure;
use axum::{
    Json, Router,
    body::Body,
    extract::{ConnectInfo, Path, Request, State},
    http::{Method, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use bytes::Bytes;
use futures_util::StreamExt;
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use rand::Rng;
use tower::ServiceExt;
use tower_http::services::ServeDir;

use config::{Config, KeyGenerator};
use store::Store;

struct App {
    config: Config,
    store: Store,
    index: String,
    dictionary: Vec<String>,
    rates: Mutex<(SystemTime, HashMap<IpAddr, u64>)>,
    previews: Mutex<VecDeque<(String, Bytes)>>,
    preview_slots: Arc<tokio::sync::Semaphore>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().any(|a| a == "--healthcheck") {
        let port = std::env::var("PORT")
            .unwrap_or_else(|_| "7777".into())
            .parse()?;
        std::net::TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], port)),
            Duration::from_secs(3),
        )?;
        return Ok(());
    }
    let config = Config::load()?;
    let level = match config.logging.level.as_str() {
        "http" | "verbose" | "debug" => "debug",
        "silly" => "trace",
        other => other,
    };
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| level.into()),
        )
        .init();
    let store = Store::new(&config.storage).await?;
    for (key, path) in &config.documents {
        let data = tokio::fs::read_to_string(path).await?;
        if !data.is_empty() {
            store.set(key, &data, true).await?;
        }
    }
    let dictionary = if let KeyGenerator::Dictionary { path } = &config.key_generator {
        let words = tokio::fs::read_to_string(path)
            .await?
            .split_whitespace()
            .map(String::from)
            .collect::<Vec<_>>();
        ensure!(!words.is_empty(), "Dictionary is empty");
        words
    } else {
        vec![]
    };
    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await?;
    tracing::info!(address = %listener.local_addr()?, "Listening");
    let app = Arc::new(App {
        config,
        store,
        dictionary,
        index: tokio::fs::read_to_string("static/index.html").await?,
        rates: Mutex::new((SystemTime::now(), HashMap::new())),
        previews: Mutex::new(VecDeque::new()),
        preview_slots: Arc::new(tokio::sync::Semaphore::new(2)),
    });
    let router = Router::new()
        .route("/documents", post(upload).get(fallback))
        .route("/documents/{id}", get(document))
        .route("/raw/{id}", get(raw))
        .route("/preview/{file}", get(image))
        .fallback(fallback)
        .method_not_allowed_fallback(fallback)
        .layer(middleware::from_fn_with_state(app.clone(), rate_limit))
        .with_state(app);
    // Express matched API route names case-insensitively and allowed a trailing slash.
    // Rewrite before routing, without lowercasing paste keys or parsing the query.
    let service = tower::util::MapRequest::new(router, |mut request: Request| {
        let uri = request.uri();
        let path = uri.path();
        let prefix = path
            .strip_prefix('/')
            .unwrap_or(path)
            .split('/')
            .next()
            .unwrap_or("");
        let lower = prefix.to_ascii_lowercase();
        if matches!(lower.as_str(), "documents" | "raw" | "preview") {
            let suffix = &path[1 + prefix.len()..];
            let suffix = suffix.strip_suffix('/').unwrap_or(suffix);
            let path = format!("/{lower}{suffix}");
            let path = uri.query().map(|q| format!("{path}?{q}")).unwrap_or(path);
            let mut parts = uri.clone().into_parts();
            parts.path_and_query = Some(path.parse().expect("Valid original URI"));
            *request.uri_mut() = axum::http::Uri::from_parts(parts).expect("Valid original URI");
        }
        request
    });
    axum::serve(
        listener,
        axum::ServiceExt::into_make_service_with_connect_info::<SocketAddr>(service),
    )
    .with_graceful_shutdown(shutdown())
    .await?;
    Ok(())
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({ "message": message }))).into_response()
}

async fn read(app: &App, id: &str) -> Option<(String, String)> {
    let key = id.split('.').next().unwrap_or(id);
    match app
        .store
        .get(key, app.config.documents.contains_key(key))
        .await
    {
        Ok(Some(data)) => Some((key.to_string(), data)),
        Ok(None) => None,
        Err(err) => {
            tracing::error!(error = %err, "Document read failed");
            None
        }
    }
}

async fn document(State(app): State<Arc<App>>, Path(id): Path<String>) -> Response {
    match read(&app, &id).await {
        Some((key, data)) => Json(serde_json::json!({ "key": key, "data": data })).into_response(),
        None => error(StatusCode::NOT_FOUND, "Document not found."),
    }
}

async fn raw(State(app): State<Arc<App>>, Path(id): Path<String>) -> Response {
    match read(&app, &id).await {
        Some((_, data)) => ([("content-type", "text/plain; charset=utf-8")], data).into_response(),
        None => error(StatusCode::NOT_FOUND, "Document not found."),
    }
}

fn too_large() -> Response {
    error(
        StatusCode::PAYLOAD_TOO_LARGE,
        "Document exceeds maximum length.",
    )
}

async fn upload(State(app): State<Arc<App>>, request: Request) -> Response {
    let content_type = request
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let multipart = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .eq_ignore_ascii_case("multipart/form-data");
    let mut buffer = Vec::new();
    let limit = app.config.max_length;
    if multipart {
        let boundary = match multer::parse_boundary(&content_type) {
            Ok(boundary) => boundary,
            Err(_) => return error(StatusCode::BAD_REQUEST, "Invalid multipart request."),
        };
        let limits = if limit == 0 {
            multer::SizeLimit::new()
        } else {
            multer::SizeLimit::new().per_field(limit as u64)
        };
        let mut form = multer::Multipart::with_constraints(
            request.into_body().into_data_stream(),
            boundary,
            multer::Constraints::new().size_limit(limits),
        );
        let mut seen = false;
        loop {
            let field = match form.next_field().await {
                Ok(Some(field)) => field,
                Ok(None) => break,
                Err(multer::Error::FieldSizeExceeded { .. }) => return too_large(),
                Err(_) => return error(StatusCode::BAD_REQUEST, "Invalid multipart request."),
            };
            if seen {
                return too_large();
            }
            if field.file_name().is_some() {
                return error(StatusCode::BAD_REQUEST, "File uploads are not supported.");
            }
            if field.name() != Some("data") {
                return error(StatusCode::BAD_REQUEST, "Expected a data field.");
            }
            seen = true;
            let charset = field
                .content_type()
                .and_then(|mime| mime.get_param("charset"))
                .map(|s| s.as_str().to_ascii_lowercase())
                .unwrap_or_else(|| "utf-8".into());
            match field.bytes().await {
                Ok(bytes) => {
                    // Busboy's Buffer decoders preserve BOMs and treat CP1252 as Latin-1.
                    let text = match charset.as_str() {
                        "utf-8" | "utf8" => String::from_utf8_lossy(&bytes).into_owned(),
                        "latin1" | "ascii" | "us-ascii" | "iso-8859-1" | "iso8859-1"
                        | "iso88591" | "iso_8859-1" | "windows-1252" | "iso_8859-1:1987"
                        | "cp1252" | "x-cp1252" => bytes.iter().map(|&b| char::from(b)).collect(),
                        "utf16le" | "utf-16le" | "ucs2" | "ucs-2" => {
                            let units = bytes
                                .chunks_exact(2)
                                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                                .collect::<Vec<_>>();
                            String::from_utf16_lossy(&units)
                        }
                        "base64" => STANDARD.encode(&bytes),
                        // Other charsets crashed the legacy parser; reject without saving.
                        _ => {
                            return error(StatusCode::BAD_REQUEST, "Invalid multipart request.");
                        }
                    };
                    buffer.extend_from_slice(text.as_bytes());
                }
                Err(multer::Error::FieldSizeExceeded { .. }) => return too_large(),
                Err(_) => return error(StatusCode::BAD_REQUEST, "Invalid multipart request."),
            }
        }
    } else {
        let mut stream = request.into_body().into_data_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(_) => return error(StatusCode::BAD_REQUEST, "Invalid request."),
            };
            if limit > 0 && buffer.len().saturating_add(chunk.len()) > limit {
                return too_large();
            }
            buffer.extend_from_slice(&chunk);
        }
    }
    let data = String::from_utf8_lossy(&buffer);
    if data.is_empty() {
        return error(StatusCode::LENGTH_REQUIRED, "Length required.");
    }
    if limit > 0 && data.len() > limit {
        return too_large();
    }
    // Atomic insert prevents simultaneous requests from overwriting the same key.
    for _ in 0..1000 {
        let key = app.key();
        match app.store.set(&key, &data, false).await {
            Ok(true) => return Json(serde_json::json!({ "key": key })).into_response(),
            Ok(false) => continue,
            Err(err) => {
                tracing::error!(error = %err, "Document save failed");
                return error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error occured while adding document.",
                );
            }
        }
    }
    error(StatusCode::SERVICE_UNAVAILABLE, "Unable to save document.")
}

impl App {
    fn key(&self) -> String {
        let mut rng = rand::rng();
        let start = rng.random_range(0..2);
        (0..self.config.key_length)
            .map(|i| {
                let space = match &self.config.key_generator {
                    KeyGenerator::Phonetic => {
                        if i % 2 == start {
                            "bcdfghjklmnpqrstvwxz"
                        } else {
                            "aeiouy"
                        }
                    }
                    KeyGenerator::Random { keyspace } => keyspace,
                    KeyGenerator::Dictionary { .. } => {
                        return self.dictionary[rng.random_range(0..self.dictionary.len())].clone();
                    }
                };
                let chars = space.chars().collect::<Vec<_>>();
                chars[rng.random_range(0..chars.len())].to_string()
            })
            .collect()
    }
}

async fn image(State(app): State<Arc<App>>, Path(file): Path<String>) -> Response {
    let Some(name) = file.strip_suffix(".png") else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut parts = name.split('.');
    let key = parts.next().unwrap_or("");
    let extension = parts.next();
    let data = match app.store.get(key, true).await {
        Ok(Some(data)) => data,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    let cache_key = format!("{name}:{:x}", md5::compute(data.as_bytes()));
    let cached = app
        .previews
        .lock()
        .unwrap()
        .iter()
        .find(|(key, _)| key == &cache_key)
        .map(|(_, png)| png.clone());
    let png = if let Some(png) = cached {
        png
    } else {
        let permit = match app.preview_slots.clone().try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        };
        let key = key.to_string();
        let extension = extension.map(String::from);
        let result = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            preview::render(&key, &data, extension.as_deref())
        })
        .await;
        let png = match result {
            Ok(Ok(png)) => Bytes::from(png),
            Ok(Err(err)) => {
                tracing::error!(error = %err, "Preview rendering failed");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
            Err(err) => {
                tracing::error!(error = %err, "Preview worker failed");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        };
        let mut cache = app.previews.lock().unwrap();
        cache.push_back((cache_key, png.clone()));
        if cache.len() > 200 {
            cache.pop_front();
        }
        png
    };
    (
        [
            ("content-type", "image/png"),
            ("cache-control", "public, max-age=86400"),
        ],
        png,
    )
        .into_response()
}

async fn fallback(State(app): State<Arc<App>>, request: Request) -> Response {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return StatusCode::NOT_FOUND.into_response();
    }
    let head = request.method() == Method::HEAD;
    let uri = request.uri().clone();
    let host = request
        .headers()
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost")
        .to_string();
    // Existing static files take priority over paste HTML. ServeDir rejects traversal.
    let (parts, _) = request.into_parts();
    let response = ServeDir::new("static")
        .append_index_html_on_directories(false)
        .oneshot(Request::from_parts(parts, Body::empty()))
        .await
        .unwrap();
    if response.status() != StatusCode::NOT_FOUND {
        let mut response = response.into_response();
        response.headers_mut().insert(
            "cache-control",
            format!("public, max-age={}", app.config.static_max_age)
                .parse()
                .unwrap(),
        );
        return response;
    }
    let id = percent_encoding::percent_decode_str(uri.path().trim_matches('/')).decode_utf8_lossy();
    if id.contains('/') {
        return StatusCode::NOT_FOUND.into_response();
    }
    let mut parts = id.split('.');
    let key = parts.next().unwrap_or("");
    let extension = parts.next();
    let data = app.store.get(key, true).await.ok().flatten();
    let mut response = if let Some(data) = data {
        let base = app
            .config
            .base_url
            .clone()
            .unwrap_or_else(|| format!("http://{host}"));
        let file = extension
            .map(|ext| format!("{key}.{ext}"))
            .unwrap_or_else(|| key.into());
        // Match encodeURIComponent: language suffix dots remain literal in preview URLs.
        const SAFE: percent_encoding::AsciiSet = NON_ALPHANUMERIC
            .remove(b'.')
            .remove(b'-')
            .remove(b'_')
            .remove(b'~')
            .remove(b'!')
            .remove(b'*')
            .remove(b'\'')
            .remove(b'(')
            .remove(b')');
        let file = utf8_percent_encode(&file, &SAFE).to_string();
        let html = preview::inject_meta(
            &app.index,
            key,
            &data,
            &format!("{base}/{file}"),
            &format!("{base}/preview/{file}.png"),
        );
        ([("cache-control", "public, max-age=300")], Html(html)).into_response()
    } else {
        (
            [(
                "cache-control",
                format!("public, max-age={}", app.config.static_max_age),
            )],
            Html(app.index.clone()),
        )
            .into_response()
    };
    // Fallback routes do not have axum's automatic GET-to-HEAD body stripping.
    if head {
        *response.body_mut() = Body::empty();
    }
    response
}

async fn rate_limit(
    State(app): State<Arc<App>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let Some(config) = &app.config.rate_limits else {
        return next.run(request).await;
    };
    let now = SystemTime::now();
    let window = Duration::from_millis(config.window_ms);
    let (hits, reset) = {
        let mut rates = app.rates.lock().unwrap();
        if now.duration_since(rates.0).unwrap_or_default() >= window {
            rates.0 = now;
            rates.1.clear();
        }
        let reset = rates.0 + window;
        let hits = rates.1.entry(peer.ip()).or_default();
        *hits = hits.saturating_add(1);
        (*hits, reset)
    };
    let mut response = if hits > config.max {
        (StatusCode::TOO_MANY_REQUESTS, config.message.clone()).into_response()
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();
    headers.insert("x-ratelimit-limit", config.max.to_string().parse().unwrap());
    headers.insert(
        "x-ratelimit-remaining",
        config.max.saturating_sub(hits).to_string().parse().unwrap(),
    );
    let reset_seconds = reset
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .div_ceil(1000);
    headers.insert(
        "x-ratelimit-reset",
        reset_seconds.to_string().parse().unwrap(),
    );
    if hits > config.max {
        headers.insert(
            "retry-after",
            reset
                .duration_since(now)
                .unwrap_or_default()
                .as_millis()
                .div_ceil(1000)
                .max(1)
                .to_string()
                .parse()
                .unwrap(),
        );
    }
    response
}
