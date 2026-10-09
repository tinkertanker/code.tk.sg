use std::cell::RefCell;

use anyhow::Context;
use base64::{Engine, engine::general_purpose::STANDARD};
use quick_js::JsValue;
use serde::Deserialize;

const FOREGROUND: &str = "#839496";
const FONT: &[u8] = include_bytes!("../lib/fonts/DejaVuSansMono.ttf");
const LOGO: &[u8] = include_bytes!("../static/tinkercademy.png");
const HIGHLIGHT: &str = include_str!("../lib/preview-highlight.js");

thread_local! {
    // QuickJS contexts stay on the blocking worker that owns them.
    static ENGINE: RefCell<Option<quick_js::Context>> = const { RefCell::new(None) };
}

pub fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn unescape(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&amp;", "&")
}

pub fn inject_meta(html: &str, key: &str, data: &str, url: &str, image: &str) -> String {
    // Match JavaScript's /\s+/ and UTF-16 slice, including BOM and astral text.
    let description = data
        .split(|c| {
            matches!(
                c,
                '\t' | '\n'
                    | '\u{000b}'
                    | '\u{000c}'
                    | '\r'
                    | ' '
                    | '\u{00a0}'
                    | '\u{1680}'
                    | '\u{2000}'
                    ..='\u{200a}'
                        | '\u{2028}'
                        | '\u{2029}'
                        | '\u{202f}'
                        | '\u{205f}'
                        | '\u{3000}'
                        | '\u{feff}'
            )
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let units = description.encode_utf16().take(201).collect::<Vec<_>>();
    let description = if units.len() > 200 {
        format!("{}…", String::from_utf16_lossy(&units[..199]))
    } else {
        description
    };
    let title = format!("code.tk.sg - {key}");
    let tags = [
        ("property", "og:site_name", "code.tk.sg"),
        ("property", "og:type", "article"),
        ("property", "og:title", &title),
        ("property", "og:description", &description),
        ("property", "og:url", url),
        ("property", "og:image", image),
        ("property", "og:image:type", "image/png"),
        ("property", "og:image:width", "1200"),
        ("property", "og:image:height", "900"),
        ("name", "twitter:card", "summary_large_image"),
        ("name", "twitter:title", &title),
        ("name", "twitter:description", &description),
        ("name", "twitter:image", image),
    ]
    .iter()
    .map(|(attr, name, content)| {
        format!(
            "\t\t<meta {attr}=\"{name}\" content=\"{}\" />",
            escape(content)
        )
    })
    .collect::<Vec<_>>()
    .join("\n");
    html.replace("</head>", &format!("{tags}\n\t</head>"))
}

fn language(extension: Option<&str>) -> Option<&str> {
    extension.map(|ext| match ext {
        "rb" => "ruby",
        "py" => "python",
        "pl" => "perl",
        "html" | "htm" => "xml",
        "js" => "javascript",
        "vbs" => "vbscript",
        "pas" | "dpr" => "delphi",
        "cc" => "cpp",
        "m" => "objectivec",
        "sm" => "smalltalk",
        "sh" => "bash",
        "erl" => "erlang",
        "hs" => "haskell",
        "md" => "markdown",
        "txt" => "",
        "coffee" => "coffeescript",
        "cs" => "csharp",
        "kt" => "kotlin",
        "lsp" => "lisp",
        "mk" => "makefile",
        "phptemp" => "php-template",
        "pyrepl" => "python-repl",
        "rs" => "rust",
        "sc" => "scala",
        _ => ext,
    })
}

#[derive(Deserialize)]
struct Highlight {
    value: String,
    language: Option<String>,
}

fn highlight(text: &str, extension: Option<&str>) -> anyhow::Result<Highlight> {
    let language = language(extension);
    if language == Some("") {
        return Ok(Highlight {
            value: escape(text),
            language: None,
        });
    }
    ENGINE.with(|engine| {
        let mut engine = engine.borrow_mut();
        if engine.is_none() {
            let context = quick_js::Context::builder()
                .memory_limit(64 * 1024 * 1024)
                .build()?;
            context
                .eval(HIGHLIGHT)
                .context("Cannot initialize highlight.js")?;
            *engine = Some(context);
        }
        let value = engine.as_ref().unwrap().call_function(
            "highlightSnippet",
            vec![
                JsValue::String(text.into()),
                language
                    .map(|s| JsValue::String(s.into()))
                    .unwrap_or(JsValue::Null),
            ],
        )?;
        let JsValue::String(json) = value else {
            anyhow::bail!("Invalid highlighter result");
        };
        Ok(serde_json::from_str(&json)?)
    })
}

fn colour(classes: &str, parent: &str) -> String {
    for class in classes.split_whitespace() {
        let value = match class.strip_prefix("hljs-").unwrap_or(class) {
            "comment" | "quote" | "tag" => "#586e75",
            "keyword" | "selector-tag" | "addition" | "code" | "template-tag" => "#859900",
            "number" | "string" | "meta-string" | "literal" | "doctag" | "regexp" => "#2aa198",
            "title" | "section" | "name" | "selector-id" | "selector-class" => "#268bd2",
            "attribute" | "attr" | "variable" | "template-variable" | "type" => "#b58900",
            "symbol" | "bullet" | "subst" | "operator" | "punctuation" | "meta"
            | "selector-attr" | "selector-pseudo" | "link" => "#cb4b16",
            "built_in" | "deletion" => "#dc322f",
            _ => continue,
        };
        return value.into();
    }
    parent.into()
}

// highlight.js emits only escaped text and nested spans. Preserve nested scopes.
fn tokenise(mut html: &str) -> Vec<Vec<(String, String)>> {
    let mut lines = vec![vec![]];
    let mut stack = vec![FOREGROUND.to_string()];
    while !html.is_empty() {
        if let Some(rest) = html.strip_prefix("<span class=\"") {
            let Some(end) = rest.find("\">") else {
                break;
            };
            stack.push(colour(&rest[..end], stack.last().unwrap()));
            html = &rest[end + 2..];
        } else if let Some(rest) = html.strip_prefix("</span>") {
            if stack.len() > 1 {
                stack.pop();
            }
            html = rest;
        } else {
            let end = html.find('<').unwrap_or(html.len());
            if end == 0 {
                break;
            }
            for (i, text) in unescape(&html[..end]).split('\n').enumerate() {
                if i > 0 {
                    lines.push(vec![]);
                }
                if !text.is_empty() {
                    lines
                        .last_mut()
                        .unwrap()
                        .push((text.into(), stack.last().unwrap().clone()));
                }
            }
            html = &html[end..];
        }
    }
    lines
}

fn build_svg(key: &str, data: &str, extension: Option<&str>) -> anyhow::Result<String> {
    let font_size: f64 = (1200.0 - 96.0) / (40.0 * 0.602 + 2.5);
    let line_height = (font_size * 1.4).round();
    let line_limit = ((900.0 - 96.0 - 48.0) / line_height) as usize;
    let snippet = data
        .split('\n')
        .take(line_limit)
        .map(|s| {
            let units = s
                .strip_suffix('\r')
                .unwrap_or(s)
                .replace('\t', "    ")
                .encode_utf16()
                .take(2000)
                .collect::<Vec<_>>();
            String::from_utf16_lossy(&units)
        })
        .collect::<Vec<_>>()
        .join("\n");
    let high = highlight(&snippet, extension)?;
    let code_x = 48.0 + font_size * 2.5;
    let total_lines = data.split('\n').count();
    let count = format!(
        "{total_lines} line{}",
        if total_lines == 1 { "" } else { "s" }
    );
    let label = high
        .language
        .map(|s| format!("{s} · {count}"))
        .unwrap_or(count);
    let mut body = String::new();
    for (i, runs) in tokenise(&high.value).iter().take(line_limit).enumerate() {
        let y = (96.0 + 24.0 + (i as f64 + 0.75) * line_height).round();
        body.push_str(&format!(
            "<text x=\"{}\" y=\"{y}\" fill=\"#586e75\" text-anchor=\"end\">{}</text>",
            (code_x - font_size * 0.9).round(),
            i + 1
        ));
        let clipped = runs.iter().map(|(s, _)| s.chars().count()).sum::<usize>() > 40;
        let mut remaining = if clipped { 39 } else { 40 };
        let mut colour = FOREGROUND;
        body.push_str(&format!(
            "<text x=\"{}\" y=\"{y}\" xml:space=\"preserve\">",
            code_x.round()
        ));
        for (text, c) in runs {
            if remaining == 0 {
                break;
            }
            let chunk = text.chars().take(remaining).collect::<String>();
            remaining -= chunk.chars().count();
            colour = c;
            body.push_str(&format!("<tspan fill=\"{c}\">{}</tspan>", escape(&chunk)));
        }
        if clipped {
            body.push_str(&format!("<tspan fill=\"{colour}\">…</tspan>"));
        }
        body.push_str("</text>");
    }
    Ok(format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
width="1200" height="900" viewBox="0 0 1200 900">
<rect width="100%" height="100%" fill="#000000"/>
<rect width="100%" height="96" fill="#073642"/>
<image x="48" y="24" width="48" height="48" xlink:href="data:image/png;base64,{}"/>
<g font-family="DejaVu Sans Mono" font-size="28">
<text x="112" y="58" fill="#eee8d5">code.tk.sg/{}</text>
<text x="1152" y="58" fill="#93a1a1" text-anchor="end">{}</text>
</g>
<g font-family="DejaVu Sans Mono" font-size="{font_size:.1}">{body}</g>
<rect y="820" width="100%" height="80" fill="url(#fade)"/>
<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000"/>
</linearGradient></defs></svg>"##,
        STANDARD.encode(LOGO),
        escape(key),
        escape(&label)
    ))
}

pub fn render(key: &str, data: &str, extension: Option<&str>) -> anyhow::Result<Vec<u8>> {
    let mut options = resvg::usvg::Options::default();
    options.fontdb_mut().load_font_data(FONT.to_vec());
    options.font_family = "DejaVu Sans Mono".into();
    let tree = resvg::usvg::Tree::from_str(&build_svg(key, data, extension)?, &options)?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(1200, 900).context("Cannot allocate preview")?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );
    Ok(pixmap.encode_png()?)
}

#[cfg(test)]
mod tests {
    use super::inject_meta;

    #[test]
    fn descriptions_keep_javascript_unicode_boundaries() {
        let html = inject_meta("</head>", "abc", &"😀".repeat(101), "url", "image");
        assert!(html.contains(&format!("content=\"{}�…\"", "😀".repeat(99))));
        let html = inject_meta("</head>", "abc", "\u{feff}a\u{feff}b\tc", "url", "image");
        assert!(html.contains("content=\"a b c\""));
    }
}
