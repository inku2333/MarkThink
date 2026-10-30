//! Integration checks that talk to a real local Ollama server.
//!
//! These are `#[ignore]`d by default because they need a running Ollama
//! instance and a downloaded model. Run them explicitly with:
//!
//! ```text
//! cargo test --test ollama_integration -- --ignored --nocapture
//! ```

use futures_util::StreamExt;
use std::time::Duration;

/// Read `OLLAMA_TEST_MODEL` or fall back to the model used during development.
fn model() -> String {
    std::env::var("OLLAMA_TEST_MODEL").unwrap_or_else(|_| "qwen3.5:4b".to_string())
}

fn endpoint() -> String {
    std::env::var("OLLAMA_TEST_ENDPOINT").unwrap_or_else(|_| "http://127.0.0.1:11434".to_string())
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(240))
        .build()
        .expect("build client")
}

/// Streaming chat against the real server, asserting we receive visible output.
///
/// This mirrors the parser contract the app relies on: answer text arrives in
/// `message.content`, reasoning in `message.thinking`, and `done` terminates
/// the stream. Thinking models must still produce something the UI can show.
#[tokio::test]
#[ignore = "requires a running Ollama server"]
async fn ollama_streams_text_for_a_real_prompt() {
    let body = serde_json::json!({
        "model": model(),
        "stream": true,
        "messages": [
            { "role": "user", "content": "用一句话说明 Markdown 是什么" }
        ],
        "options": { "num_predict": 200 }
    });

    let resp = client()
        .post(format!("{}/api/chat", endpoint()))
        .json(&body)
        .send()
        .await
        .expect("connect to Ollama (is it running?)");

    assert!(resp.status().is_success(), "HTTP {}", resp.status());

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut saw_done = false;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.expect("read chunk");
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(idx) = buf.find('\n') {
            let line = buf[..idx].trim().to_string();
            buf.drain(..=idx);
            if line.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if value["done"].as_bool() == Some(true) {
                saw_done = true;
                break;
            }
            if let Some(t) = value["message"]["content"].as_str() {
                content.push_str(t);
            }
            if let Some(t) = value["message"]["thinking"].as_str() {
                reasoning.push_str(t);
            }
        }
        // Enough evidence collected; no need to wait for the full answer.
        if saw_done || content.len() + reasoning.len() > 400 {
            break;
        }
    }

    assert!(
        !content.is_empty() || !reasoning.is_empty(),
        "model produced neither content nor reasoning; the panel would show nothing"
    );

    let preview: String = if content.is_empty() {
        reasoning.chars().take(200).collect()
    } else {
        content.chars().take(200).collect()
    };
    println!(
        "content={} chars, reasoning={} chars, done={}",
        content.len(),
        reasoning.len(),
        saw_done
    );
    println!("preview: {preview}");
}

/// The model catalog endpoint used by the provider test button.
#[tokio::test]
#[ignore = "requires a running Ollama server"]
async fn ollama_lists_installed_models() {
    let resp = client()
        .get(format!("{}/api/tags", endpoint()))
        .send()
        .await
        .expect("connect to Ollama");

    assert!(resp.status().is_success());
    let value: serde_json::Value = resp.json().await.expect("parse tags");
    let models = value["models"].as_array().expect("models array").len();
    println!("installed models: {models}");
    assert!(models > 0, "no models installed; run `ollama pull <model>`");
}
