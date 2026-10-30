//! Verifies the exact fallback the app applies when a thinking model never
//! emits answer text: the reasoning must still reach the user.
//!
//! Run with a live server:
//! ```text
//! cargo test --test reasoning_fallback -- --ignored --nocapture
//! ```

use futures_util::StreamExt;
use std::time::Duration;

fn model() -> String {
    std::env::var("OLLAMA_TEST_MODEL").unwrap_or_else(|_| "qwen3.5:4b".to_string())
}

fn endpoint() -> String {
    std::env::var("OLLAMA_TEST_ENDPOINT").unwrap_or_else(|_| "http://127.0.0.1:11434".to_string())
}

/// Replicates `consume_stream`: collect answer and reasoning separately, then
/// fall back to the reasoning when the answer stayed empty.
#[tokio::test]
#[ignore = "requires a running Ollama server"]
async fn reasoning_only_models_still_produce_visible_output() {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(240))
        .build()
        .expect("client");

    let body = serde_json::json!({
        "model": model(),
        "stream": true,
        "messages": [{ "role": "user", "content": "用一句话说明 Markdown 是什么" }],
        "options": { "num_predict": 300 }
    });

    let resp = client
        .post(format!("{}/api/chat", endpoint()))
        .json(&body)
        .send()
        .await
        .expect("connect to Ollama");

    assert!(resp.status().is_success());

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut answer = String::new();
    let mut reasoning = String::new();

    'outer: while let Some(chunk) = stream.next().await {
        let chunk = chunk.expect("chunk");
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buf.find('\n') {
            let line = buf[..idx].trim().to_string();
            buf.drain(..=idx);
            if line.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if v["done"].as_bool() == Some(true) {
                break 'outer;
            }
            if let Some(t) = v["message"]["content"].as_str() {
                answer.push_str(t);
            }
            if let Some(t) = v["message"]["thinking"].as_str() {
                reasoning.push_str(t);
            }
        }
    }

    // The app's fallback rule.
    let visible = if answer.is_empty() { reasoning.clone() } else { answer.clone() };

    println!(
        "answer={} chars, reasoning={} chars, visible={} chars",
        answer.len(),
        reasoning.len(),
        visible.len()
    );
    println!("preview: {}", visible.chars().take(200).collect::<String>());

    assert!(
        !visible.is_empty(),
        "the panel would render nothing: answer empty and no reasoning captured"
    );
}
