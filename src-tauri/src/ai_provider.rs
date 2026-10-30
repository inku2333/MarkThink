use crate::ai::{
    build_user_message, mode_prompt, AiProvider, DeltaPayload, InterpretRequest, StatusPayload,
};
use futures_util::StreamExt;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// Cancellation flags, keyed by request id.
#[derive(Default)]
pub struct CancelState {
    flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl CancelState {
    fn flag(&self, id: &str) -> Arc<AtomicBool> {
        let mut guard = self.flags.lock();
        guard
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .clone()
    }
    fn clear(&self, id: &str) {
        self.flags.lock().remove(id);
    }
}

/// Catalog of supported providers. `protocol` decides how the request is
/// shaped and how the stream is parsed.
pub fn providers() -> Vec<AiProvider> {
    vec![
        AiProvider {
            id: "deepseek".into(),
            name: "DeepSeek".into(),
            description: "国内直连，性价比高，适合中文文档解读".into(),
            protocol: "openai".into(),
            default_endpoint: Some("https://api.deepseek.com/v1".into()),
            default_model: Some("deepseek-chat".into()),
            models: vec![
                "deepseek-chat".into(),
                "deepseek-reasoner".into(),
            ],
            needs_key: true,
            needs_endpoint: true,
            key_url: Some("https://platform.deepseek.com/api_keys".into()),
            local: false,
        },
        AiProvider {
            id: "openai".into(),
            name: "OpenAI".into(),
            description: "GPT 系列模型，推理与写作能力强".into(),
            protocol: "openai".into(),
            default_endpoint: Some("https://api.openai.com/v1".into()),
            default_model: Some("gpt-4o-mini".into()),
            models: vec![
                "gpt-4o-mini".into(),
                "gpt-4o".into(),
                "gpt-4.1".into(),
                "gpt-4.1-mini".into(),
                "o3-mini".into(),
            ],
            needs_key: true,
            needs_endpoint: true,
            key_url: Some("https://platform.openai.com/api-keys".into()),
            local: false,
        },
        AiProvider {
            id: "openai-compatible".into(),
            name: "OpenAI 兼容接口".into(),
            description: "任意兼容 /chat/completions 的服务，如 Moonshot、智谱、通义、硅基流动".into(),
            protocol: "openai".into(),
            default_endpoint: Some("https://api.openai.com/v1".into()),
            default_model: None,
            models: vec![],
            needs_key: true,
            needs_endpoint: true,
            key_url: None,
            local: false,
        },
        AiProvider {
            id: "moonshot".into(),
            name: "Moonshot (Kimi)".into(),
            description: "长上下文见长，适合整篇长文档解读".into(),
            protocol: "openai".into(),
            default_endpoint: Some("https://api.moonshot.cn/v1".into()),
            default_model: Some("kimi-k2-0905-preview".into()),
            models: vec![
                "kimi-k2-0905-preview".into(),
                "moonshot-v1-8k".into(),
                "moonshot-v1-32k".into(),
                "moonshot-v1-128k".into(),
            ],
            needs_key: true,
            needs_endpoint: true,
            key_url: Some("https://platform.moonshot.cn/console/api-keys".into()),
            local: false,
        },
        AiProvider {
            id: "zhipu".into(),
            name: "智谱 GLM".into(),
            description: "智谱清言开放平台，中文表现稳定".into(),
            protocol: "openai".into(),
            default_endpoint: Some("https://open.bigmodel.cn/api/paas/v4".into()),
            default_model: Some("glm-4-flash".into()),
            models: vec![
                "glm-4-flash".into(),
                "glm-4-plus".into(),
                "glm-4-air".into(),
            ],
            needs_key: true,
            needs_endpoint: true,
            key_url: Some("https://open.bigmodel.cn/usercenter/apikeys".into()),
            local: false,
        },
        AiProvider {
            id: "dashscope".into(),
            name: "通义千问".into(),
            description: "阿里云百炼，模型可选范围广".into(),
            protocol: "openai".into(),
            default_endpoint: Some("https://dashscope.aliyuncs.com/compatible-mode/v1".into()),
            default_model: Some("qwen-plus".into()),
            models: vec![
                "qwen-plus".into(),
                "qwen-max".into(),
                "qwen-turbo".into(),
            ],
            needs_key: true,
            needs_endpoint: true,
            key_url: Some("https://bailian.console.aliyun.com/".into()),
            local: false,
        },
        AiProvider {
            id: "openrouter".into(),
            name: "OpenRouter".into(),
            description: "一个密钥访问多家模型，适合对比不同模型效果".into(),
            protocol: "openai".into(),
            default_endpoint: Some("https://openrouter.ai/api/v1".into()),
            default_model: Some("anthropic/claude-sonnet-4.5".into()),
            models: vec![
                "anthropic/claude-sonnet-4.5".into(),
                "openai/gpt-4o".into(),
                "google/gemini-2.5-pro".into(),
                "deepseek/deepseek-chat".into(),
            ],
            needs_key: true,
            needs_endpoint: true,
            key_url: Some("https://openrouter.ai/keys".into()),
            local: false,
        },
        AiProvider {
            id: "anthropic".into(),
            name: "Anthropic Claude".into(),
            description: "长文理解与批判性分析质量突出".into(),
            protocol: "anthropic".into(),
            default_endpoint: Some("https://api.anthropic.com/v1".into()),
            default_model: Some("claude-sonnet-4-5".into()),
            models: vec![
                "claude-sonnet-4-5".into(),
                "claude-opus-4-1".into(),
                "claude-haiku-4-5".into(),
            ],
            needs_key: true,
            needs_endpoint: true,
            key_url: Some("https://console.anthropic.com/settings/keys".into()),
            local: false,
        },
        AiProvider {
            id: "gemini".into(),
            name: "Google Gemini".into(),
            description: "上下文窗口大，免费额度较宽松".into(),
            protocol: "gemini".into(),
            default_endpoint: Some("https://generativelanguage.googleapis.com/v1beta".into()),
            default_model: Some("gemini-2.5-flash".into()),
            models: vec![
                "gemini-2.5-flash".into(),
                "gemini-2.5-pro".into(),
                "gemini-2.0-flash".into(),
            ],
            needs_key: true,
            needs_endpoint: true,
            key_url: Some("https://aistudio.google.com/app/apikey".into()),
            local: false,
        },
        AiProvider {
            id: "ollama".into(),
            name: "Ollama 本地模型".into(),
            description: "完全离线运行，无需 API Key，文档不出本机".into(),
            protocol: "ollama".into(),
            default_endpoint: Some("http://127.0.0.1:11434".into()),
            default_model: Some("qwen3.5:4b".into()),
            models: vec![],
            needs_key: false,
            needs_endpoint: true,
            key_url: Some("https://ollama.com/download".into()),
            local: true,
        },
    ]
}

/// One parsed streaming event.
///
/// `Reasoning` is a model's private thinking (qwen3, DeepSeek-R1 and friends).
/// It is streamed separately from the answer so the UI can show a "thinking"
/// indicator instead of dumping raw chain-of-thought into the result.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum StreamEvent {
    Delta(String),
    Reasoning(String),
    Done,
}

/// Parse an OpenAI-compatible SSE line.
pub(crate) fn parse_openai_sse_line(line: &str) -> Option<StreamEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let data = trimmed.strip_prefix("data:")?.trim();
    if data.is_empty() {
        return None;
    }
    if data == "[DONE]" {
        return Some(StreamEvent::Done);
    }
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    if let Some(token) = value["choices"][0]["delta"]["content"].as_str() {
        if !token.is_empty() {
            return Some(StreamEvent::Delta(token.to_string()));
        }
    }
    // Reasoning tokens are separate from the answer; report them as progress.
    if let Some(token) = value["choices"][0]["delta"]["reasoning_content"].as_str() {
        if !token.is_empty() {
            return Some(StreamEvent::Reasoning(token.to_string()));
        }
    }
    if value["choices"][0]["finish_reason"].is_string() {
        return Some(StreamEvent::Done);
    }
    None
}

/// Parse an Anthropic SSE line (`content_block_delta` carries the text).
pub(crate) fn parse_anthropic_sse_line(line: &str) -> Option<StreamEvent> {
    let trimmed = line.trim();
    let data = trimmed.strip_prefix("data:")?.trim();
    if data.is_empty() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    match value["type"].as_str()? {
        "content_block_delta" => {
            let text = value["delta"]["text"].as_str()?;
            if text.is_empty() {
                None
            } else {
                Some(StreamEvent::Delta(text.to_string()))
            }
        }
        "message_stop" => Some(StreamEvent::Done),
        _ => None,
    }
}

/// Parse a Gemini stream line (`candidates[0].content.parts[].text`).
pub(crate) fn parse_gemini_line(line: &str) -> Option<StreamEvent> {
    let trimmed = line.trim();
    let data = trimmed.strip_prefix("data:")?.trim();
    if data.is_empty() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    if let Some(parts) = value["candidates"][0]["content"]["parts"].as_array() {
        let text: String = parts
            .iter()
            .filter_map(|p| p["text"].as_str())
            .collect();
        if !text.is_empty() {
            return Some(StreamEvent::Delta(text));
        }
    }
    if value["candidates"][0]["finishReason"].is_string() {
        return Some(StreamEvent::Done);
    }
    None
}

/// Parse an Ollama NDJSON line.
///
/// Thinking models such as qwen3 stream their reasoning into `message.thinking`
/// and leave `message.content` empty until the reasoning finishes. The two are
/// reported separately: reasoning drives a progress indicator, content is the
/// answer shown to the user.
pub(crate) fn parse_ollama_line(line: &str) -> Option<StreamEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    if value["done"].as_bool() == Some(true) {
        return Some(StreamEvent::Done);
    }
    if let Some(token) = value["message"]["content"].as_str() {
        if !token.is_empty() {
            return Some(StreamEvent::Delta(token.to_string()));
        }
    }
    if let Some(token) = value["message"]["thinking"].as_str() {
        if !token.is_empty() {
            return Some(StreamEvent::Reasoning(token.to_string()));
        }
    }
    None
}

fn emit_delta(app: &AppHandle, request_id: &str, delta: &str, done: bool) {
    let _ = app.emit(
        "markthink://ai-delta",
        DeltaPayload {
            request_id: request_id.to_string(),
            delta: delta.to_string(),
            done,
        },
    );
}

fn emit_status(app: &AppHandle, request_id: &str, status: &str, message: Option<String>) {
    let _ = app.emit(
        "markthink://ai-status",
        StatusPayload {
            request_id: request_id.to_string(),
            status: status.to_string(),
            message,
            prompt_tokens: None,
        },
    );
}

fn effective_endpoint(req: &InterpretRequest, provider: &AiProvider) -> String {
    req.endpoint
        .clone()
        .filter(|e| !e.trim().is_empty())
        .or_else(|| provider.default_endpoint.clone())
        .unwrap_or_default()
        .trim_end_matches('/')
        .to_string()
}

fn effective_model(req: &InterpretRequest, provider: &AiProvider) -> String {
    req.model
        .clone()
        .filter(|m| !m.trim().is_empty())
        .or_else(|| provider.default_model.clone())
        .unwrap_or_else(|| "default".into())
}

/// Consume an SSE/NDJSON response, emitting deltas as they arrive.
///
/// Reasoning text is held back while the answer streams in. Some thinking
/// models never emit `content` at all (they finish inside the reasoning
/// channel), so when the stream ends with an empty answer the reasoning is
/// emitted instead — an empty panel would look like a broken feature.
async fn consume_stream<F>(
    app: &AppHandle,
    request_id: &str,
    response: reqwest::Response,
    cancel: Arc<AtomicBool>,
    parse: F,
) -> Result<(), String>
where
    F: Fn(&str) -> Option<StreamEvent>,
{
    let mut stream = response.bytes_stream();
    let mut buf = String::new();
    let mut finished = false;
    let mut answer_len = 0usize;
    let mut reasoning = String::new();

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            emit_status(app, request_id, "cancelled", None);
            return Ok(());
        }
        let chunk = chunk.map_err(|e| format!("流读取失败: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(idx) = buf.find('\n') {
            let line = buf[..idx].trim_end_matches('\r').to_string();
            buf.drain(..=idx);

            match parse(&line) {
                Some(StreamEvent::Delta(text)) => {
                    answer_len += text.len();
                    emit_delta(app, request_id, &text, false);
                }
                Some(StreamEvent::Reasoning(text)) => {
                    reasoning.push_str(&text);
                    emit_status(app, request_id, "reasoning", None);
                }
                Some(StreamEvent::Done) => {
                    finished = true;
                    break;
                }
                None => {}
            }
        }
        if finished {
            break;
        }
    }

    // The model thought but never produced an answer: show the reasoning so the
    // user gets the model's analysis instead of an empty result.
    if answer_len == 0 && !reasoning.is_empty() {
        emit_delta(app, request_id, &reasoning, false);
    }

    emit_delta(app, request_id, "", true);
    emit_status(app, request_id, "finished", None);
    Ok(())
}

async fn run_openai_like(
    app: AppHandle,
    req: InterpretRequest,
    provider: AiProvider,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let endpoint = effective_endpoint(&req, &provider);
    let model = effective_model(&req, &provider);
    let key = req.api_key.clone().unwrap_or_default();

    let mut messages = vec![serde_json::json!({
        "role": "system",
        "content": mode_prompt(&req.mode, &req.language)
    })];
    for turn in &req.history {
        messages.push(serde_json::json!({ "role": turn.role, "content": turn.content }));
    }
    messages.push(serde_json::json!({
        "role": "user",
        "content": build_user_message(&req)
    }));

    let body = serde_json::json!({
        "model": model,
        "stream": true,
        "temperature": req.temperature.unwrap_or(0.4),
        "max_tokens": req.max_tokens.unwrap_or(4096),
        "messages": messages,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let mut rb = client.post(format!("{endpoint}/chat/completions")).json(&body);
    if !key.is_empty() {
        rb = rb.bearer_auth(&key);
    }

    let resp = rb.send().await.map_err(|e| format!("请求失败: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {}", truncate(&text, 500)));
    }

    consume_stream(&app, &req.request_id, resp, cancel, parse_openai_sse_line).await
}

async fn run_anthropic(
    app: AppHandle,
    req: InterpretRequest,
    provider: AiProvider,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let endpoint = effective_endpoint(&req, &provider);
    let model = effective_model(&req, &provider);
    let key = req.api_key.clone().unwrap_or_default();

    let mut messages: Vec<serde_json::Value> = req
        .history
        .iter()
        .filter(|t| t.role != "system")
        .map(|t| serde_json::json!({ "role": t.role, "content": t.content }))
        .collect();
    messages.push(serde_json::json!({
        "role": "user",
        "content": build_user_message(&req)
    }));

    let body = serde_json::json!({
        "model": model,
        "max_tokens": req.max_tokens.unwrap_or(4096),
        "temperature": req.temperature.unwrap_or(0.4),
        "system": mode_prompt(&req.mode, &req.language),
        "messages": messages,
        "stream": true,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{endpoint}/messages"))
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {}", truncate(&text, 500)));
    }

    consume_stream(&app, &req.request_id, resp, cancel, parse_anthropic_sse_line).await
}

async fn run_gemini(
    app: AppHandle,
    req: InterpretRequest,
    provider: AiProvider,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let endpoint = effective_endpoint(&req, &provider);
    let model = effective_model(&req, &provider);
    let key = req.api_key.clone().unwrap_or_default();

    let mut contents: Vec<serde_json::Value> = req
        .history
        .iter()
        .filter(|t| t.role != "system")
        .map(|t| {
            let role = if t.role == "assistant" { "model" } else { "user" };
            serde_json::json!({ "role": role, "parts": [{ "text": t.content }] })
        })
        .collect();
    contents.push(serde_json::json!({
        "role": "user",
        "parts": [{ "text": build_user_message(&req) }]
    }));

    let body = serde_json::json!({
        "systemInstruction": { "parts": [{ "text": mode_prompt(&req.mode, &req.language) }] },
        "contents": contents,
        "generationConfig": {
            "temperature": req.temperature.unwrap_or(0.4),
            "maxOutputTokens": req.max_tokens.unwrap_or(4096),
        },
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!(
        "{endpoint}/models/{model}:streamGenerateContent?alt=sse&key={key}"
    );
    let resp = client
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {}", truncate(&text, 500)));
    }

    consume_stream(&app, &req.request_id, resp, cancel, parse_gemini_line).await
}

async fn run_ollama(
    app: AppHandle,
    req: InterpretRequest,
    provider: AiProvider,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let endpoint = effective_endpoint(&req, &provider);
    let model = effective_model(&req, &provider);

    let mut messages = vec![serde_json::json!({
        "role": "system",
        "content": mode_prompt(&req.mode, &req.language)
    })];
    for turn in &req.history {
        messages.push(serde_json::json!({ "role": turn.role, "content": turn.content }));
    }
    messages.push(serde_json::json!({
        "role": "user",
        "content": build_user_message(&req)
    }));

    let body = serde_json::json!({
        "model": model,
        "stream": true,
        "messages": messages,
        "options": {
            "temperature": req.temperature.unwrap_or(0.4),
            "num_predict": req.max_tokens.unwrap_or(4096),
        },
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{endpoint}/api/chat"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("无法连接 Ollama（是否已启动？）: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {}", truncate(&text, 500)));
    }

    consume_stream(&app, &req.request_id, resp, cancel, parse_ollama_line).await
}

#[tauri::command]
pub fn list_providers() -> Vec<AiProvider> {
    providers()
}

#[tauri::command]
pub async fn interpret_document(app: AppHandle, req: InterpretRequest) -> Result<(), String> {
    let state = app.state::<CancelState>();
    let cancel = state.flag(&req.request_id);

    let provider = providers()
        .into_iter()
        .find(|p| p.id == req.provider)
        .ok_or_else(|| format!("未知的模型提供方: {}", req.provider))?;

    emit_status(&app, &req.request_id, "started", None);

    let result = match provider.protocol.as_str() {
        "openai" => run_openai_like(app.clone(), req.clone(), provider.clone(), cancel.clone()).await,
        "anthropic" => run_anthropic(app.clone(), req.clone(), provider.clone(), cancel.clone()).await,
        "gemini" => run_gemini(app.clone(), req.clone(), provider.clone(), cancel.clone()).await,
        "ollama" => run_ollama(app.clone(), req.clone(), provider.clone(), cancel.clone()).await,
        other => Err(format!("不支持的协议: {other}")),
    };

    if let Err(msg) = &result {
        emit_status(&app, &req.request_id, "error", Some(msg.clone()));
    }
    state.clear(&req.request_id);
    result
}

#[tauri::command]
pub fn cancel_interpretation(app: AppHandle, request_id: String) {
    let state = app.state::<CancelState>();
    let flag = state.flag(&request_id);
    flag.store(true, Ordering::SeqCst);
}

/// Probe a provider so the user gets immediate feedback on a bad key/endpoint.
#[tauri::command]
pub async fn test_provider(
    provider: String,
    endpoint: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    let p = providers()
        .into_iter()
        .find(|x| x.id == provider)
        .ok_or_else(|| "未知的模型提供方".to_string())?;

    let ep = endpoint
        .filter(|e| !e.trim().is_empty())
        .or(p.default_endpoint.clone())
        .unwrap_or_default()
        .trim_end_matches('/')
        .to_string();
    let key = api_key.unwrap_or_default();
    let mdl = model
        .filter(|m| !m.trim().is_empty())
        .or(p.default_model.clone())
        .unwrap_or_default();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    match p.protocol.as_str() {
        "ollama" => {
            let resp = client
                .get(format!("{ep}/api/tags"))
                .send()
                .await
                .map_err(|e| format!("无法连接（Ollama 是否已启动？）: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("HTTP {}", resp.status()));
            }
            let v: serde_json::Value = resp.json().await.unwrap_or_default();
            let names: Vec<String> = v["models"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            if names.is_empty() {
                return Ok("Ollama 在线，但还没有下载任何模型。可运行 `ollama pull qwen3.5:4b`".into());
            }
            let has_model = names.iter().any(|n| n == &mdl || n.starts_with(&format!("{mdl}:")));
            if has_model {
                Ok(format!("Ollama 在线，模型 {mdl} 可用（共 {} 个模型）", names.len()))
            } else {
                Ok(format!(
                    "Ollama 在线，但未找到 {mdl}。可用模型：{}",
                    names.join(", ")
                ))
            }
        }
        "openai" => {
            let mut rb = client.get(format!("{ep}/models"));
            if !key.is_empty() {
                rb = rb.bearer_auth(&key);
            }
            let resp = rb
                .send()
                .await
                .map_err(|e| format!("无法连接: {e}"))?;
            if resp.status().is_success() {
                Ok("连接成功，密钥有效".into())
            } else {
                Err(format!("HTTP {}（密钥或地址可能有误）", resp.status()))
            }
        }
        "anthropic" => {
            // A tiny 1-token request is the cheapest reliable auth check.
            let resp = client
                .post(format!("{ep}/messages"))
                .header("x-api-key", &key)
                .header("anthropic-version", "2023-06-01")
                .json(&serde_json::json!({
                    "model": mdl,
                    "max_tokens": 1,
                    "messages": [{"role":"user","content":"hi"}]
                }))
                .send()
                .await
                .map_err(|e| format!("无法连接: {e}"))?;
            if resp.status().is_success() {
                Ok("连接成功，密钥有效".into())
            } else {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                Err(format!("HTTP {status}: {}", truncate(&text, 300)))
            }
        }
        "gemini" => {
            let resp = client
                .get(format!("{ep}/models?key={key}"))
                .send()
                .await
                .map_err(|e| format!("无法连接: {e}"))?;
            if resp.status().is_success() {
                Ok("连接成功，密钥有效".into())
            } else {
                Err(format!("HTTP {}（密钥可能有误）", resp.status()))
            }
        }
        other => Err(format!("不支持的协议: {other}")),
    }
}

/// List locally installed Ollama models so the UI can offer them directly.
#[tauri::command]
pub async fn list_ollama_models(endpoint: Option<String>) -> Result<Vec<String>, String> {
    let ep = endpoint
        .filter(|e| !e.trim().is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:11434".into())
        .trim_end_matches('/')
        .to_string();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(format!("{ep}/api/tags"))
        .send()
        .await
        .map_err(|e| format!("无法连接 Ollama: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let v: serde_json::Value = resp.json().await.unwrap_or_default();
    Ok(v["models"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default())
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n).collect::<String>() + "…"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_delta_is_extracted() {
        let line = r#"data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}"#;
        assert_eq!(
            parse_openai_sse_line(line),
            Some(StreamEvent::Delta("你好".into()))
        );
    }

    #[test]
    fn openai_done_and_metadata_handling() {
        assert_eq!(parse_openai_sse_line("data: [DONE]"), Some(StreamEvent::Done));
        let role = r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#;
        assert_eq!(parse_openai_sse_line(role), None);
        assert_eq!(parse_openai_sse_line(""), None);
        assert_eq!(parse_openai_sse_line("event: message"), None);
    }

    #[test]
    fn reasoning_content_is_separated_from_the_answer() {
        let line = r#"data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}"#;
        assert_eq!(
            parse_openai_sse_line(line),
            Some(StreamEvent::Reasoning("思考中".into()))
        );
        // Real content is still the answer.
        let answer = r#"data: {"choices":[{"delta":{"content":"答案"}}]}"#;
        assert_eq!(
            parse_openai_sse_line(answer),
            Some(StreamEvent::Delta("答案".into()))
        );
    }

    #[test]
    fn anthropic_events_parse() {
        let delta = r#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"片段"}}"#;
        assert_eq!(
            parse_anthropic_sse_line(delta),
            Some(StreamEvent::Delta("片段".into()))
        );
        let stop = r#"data: {"type":"message_stop"}"#;
        assert_eq!(parse_anthropic_sse_line(stop), Some(StreamEvent::Done));
        let start = r#"data: {"type":"message_start"}"#;
        assert_eq!(parse_anthropic_sse_line(start), None);
    }

    #[test]
    fn gemini_events_parse() {
        let line = r#"data: {"candidates":[{"content":{"parts":[{"text":"回答"}]}}]}"#;
        assert_eq!(parse_gemini_line(line), Some(StreamEvent::Delta("回答".into())));
        let finish = r#"data: {"candidates":[{"finishReason":"STOP"}]}"#;
        assert_eq!(parse_gemini_line(finish), Some(StreamEvent::Done));
    }

    #[test]
    fn ollama_events_parse() {
        let token = r#"{"message":{"role":"assistant","content":"片段"},"done":false}"#;
        assert_eq!(parse_ollama_line(token), Some(StreamEvent::Delta("片段".into())));
        let last = r#"{"message":{"content":""},"done":true}"#;
        assert_eq!(parse_ollama_line(last), Some(StreamEvent::Done));
    }

    #[test]
    fn ollama_thinking_is_reported_as_reasoning() {
        // qwen3 and similar models stream reasoning before any content.
        let thinking = r#"{"message":{"role":"assistant","content":"","thinking":"思考中"},"done":false}"#;
        assert_eq!(
            parse_ollama_line(thinking),
            Some(StreamEvent::Reasoning("思考中".into()))
        );
        // Once real content arrives it takes priority as the answer.
        let both = r#"{"message":{"content":"答案","thinking":"思考"},"done":false}"#;
        assert_eq!(parse_ollama_line(both), Some(StreamEvent::Delta("答案".into())));
        // A chunk with neither field is not an event.
        let empty = r#"{"message":{"content":"","thinking":""},"done":false}"#;
        assert_eq!(parse_ollama_line(empty), None);
    }

    #[test]
    fn every_provider_declares_a_protocol() {
        for p in providers() {
            assert!(
                ["openai", "anthropic", "gemini", "ollama"].contains(&p.protocol.as_str()),
                "provider {} has unknown protocol {}",
                p.id,
                p.protocol
            );
            assert!(!p.name.is_empty());
            if p.needs_key {
                assert!(!p.id.is_empty());
            }
        }
    }

    #[test]
    fn ollama_is_the_only_local_provider() {
        let locals: Vec<_> = providers().into_iter().filter(|p| p.local).collect();
        assert_eq!(locals.len(), 1);
        assert_eq!(locals[0].id, "ollama");
        assert!(!locals[0].needs_key);
    }

    /// Models that answer only inside their reasoning channel must still
    /// produce visible output, otherwise the panel looks broken.
    #[test]
    fn reasoning_only_stream_falls_back_to_showing_reasoning() {
        let lines = [
            r#"{"message":{"content":"","thinking":"思考中"},"done":false}"#,
            r#"{"message":{"content":"","thinking":"…"},"done":false}"#,
            r#"{"message":{"content":""},"done":true}"#,
        ];

        let mut answer_len = 0usize;
        let mut reasoning = String::new();
        for line in lines {
            match parse_ollama_line(line) {
                Some(StreamEvent::Delta(t)) => answer_len += t.len(),
                Some(StreamEvent::Reasoning(t)) => reasoning.push_str(&t),
                Some(StreamEvent::Done) | None => {}
            }
        }

        assert_eq!(answer_len, 0, "this fixture must not contain answer text");
        assert!(!reasoning.is_empty(), "reasoning should have been captured");
        // The fallback the stream consumer applies.
        let shown = if answer_len == 0 { reasoning.as_str() } else { "" };
        assert_eq!(shown, "思考中…");
    }
}
