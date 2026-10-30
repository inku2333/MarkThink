use serde::{Deserialize, Serialize};

/// A model provider the user can pick in the AI panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProvider {
    pub id: String,
    pub name: String,
    pub description: String,
    /// Wire protocol used to talk to the service.
    pub protocol: String,
    pub default_endpoint: Option<String>,
    pub default_model: Option<String>,
    pub models: Vec<String>,
    pub needs_key: bool,
    pub needs_endpoint: bool,
    pub key_url: Option<String>,
    pub local: bool,
}

/// What the user wants from the model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterpretRequest {
    pub request_id: String,
    pub provider: String,
    pub endpoint: Option<String>,
    pub model: Option<String>,
    pub api_key: Option<String>,
    /// One of `overview`, `outline`, `critique`, `explain`, `qa`.
    pub mode: String,
    pub language: String,
    /// Extra user instructions appended to the built-in prompt.
    pub instruction: Option<String>,
    pub document_title: Option<String>,
    /// The full document, already trimmed to a size the model can accept.
    pub content: String,
    /// Follow-up conversation for `qa` mode.
    pub history: Vec<ChatTurn>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaPayload {
    pub request_id: String,
    pub delta: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    pub request_id: String,
    pub status: String,
    pub message: Option<String>,
    pub prompt_tokens: Option<u32>,
}

/// Whether the requested output language is Chinese.
///
/// The frontend sends display names such as `简体中文`, while API-style callers
/// may send `zh-CN`. Accept both so the prompt language always matches the
/// language the user picked.
fn is_chinese(language: &str) -> bool {
    let lang = language.trim();
    lang.to_ascii_lowercase().starts_with("zh")
        || lang.contains("简体")
        || lang.contains("繁體")
        || lang.contains("繁体")
        || lang.contains('中')
}

/// The system prompt for each interpretation mode. Kept in Rust so the
/// behaviour is identical regardless of which frontend calls it.
pub fn mode_prompt(mode: &str, language: &str) -> String {
    let zh = is_chinese(language);
    match mode {
        "overview" if zh => format!(
            "你是文档解读助手。请用{language}输出一份结构化解读，包含：\n\
             1. 一句话总览（这篇文档在讲什么）\n\
             2. 核心论点（3-6 条，每条一句话，附上支撑它的关键信息）\n\
             3. 关键概念（列出文中出现的重要术语并简要解释）\n\
             4. 结构与逻辑（作者如何组织内容、论证链条是否完整）\n\
             5. 值得注意的细节（数据、结论、限制条件、作者的隐含假设）\n\n\
             要求：只依据文档内容，不要编造文档里没有的信息；如果某一部分文档没有涉及，直接说明“文档未涉及”。\
             使用 Markdown 输出，层级清晰，避免空洞套话。"
        ),
        "overview" => format!(
            "You are a document analyst. Produce a structured reading of the document in {language}:\n\
             1. One-sentence summary\n\
             2. Core claims (3-6 bullets, each with the evidence behind it)\n\
             3. Key concepts (list and briefly explain the important terms)\n\
             4. Structure and logic (how the author organizes the content, whether the argument holds)\n\
             5. Notable details (data, conclusions, caveats, implicit assumptions)\n\n\
             Ground everything in the document; do not invent facts. If a section is not covered, say so explicitly.\
             Respond in Markdown."
        ),
        "outline" if zh => format!(
            "你是文档结构分析助手。请用{language}输出这篇文档的知识结构：\n\
             1. 一句话概括\n\
             2. 分层大纲（用缩进列表还原作者的论证层级，每一层给出该层的核心意思）\n\
             3. 章节之间的关系（递进、并列、对比、因果等）\n\
             4. 若把这篇文档压缩成 5 条要点，会是哪 5 条\n\n\
             只依据文档内容，使用 Markdown 输出。"
        ),
        "outline" => format!(
            "Analyze the structure of this document and answer in {language}:\n\
             1. One-sentence summary\n\
             2. Hierarchical outline (nested list reflecting the author's argument levels, with the gist of each)\n\
             3. How the sections relate (progression, parallel, contrast, causation)\n\
             4. If condensed into exactly five takeaways, what would they be\n\n\
             Ground everything in the document. Respond in Markdown."
        ),
        "critique" if zh => format!(
            "你是严谨的评审者。请用{language}对这篇文档做批判性评估：\n\
             1. 主要贡献（它提供了什么有价值的东西）\n\
             2. 论证强度（哪些结论有充分支撑，哪些只是断言）\n\
             3. 潜在问题（逻辑跳跃、证据不足、样本偏差、过度概括等，逐条指出并说明理由）\n\
             4. 未回答的问题（作者回避或未展开的关键点）\n\
             5. 可信度评估（总体而言这篇文档可以信到什么程度）\n\n\
             要具体，引用文档中的实际内容作为依据，避免泛泛而谈。使用 Markdown 输出。"
        ),
        "critique" => format!(
            "Act as a rigorous reviewer. Evaluate this document in {language}:\n\
             1. Main contributions\n\
             2. Strength of the argument (which conclusions are well supported, which are mere assertions)\n\
             3. Potential problems (logical gaps, insufficient evidence, sampling bias, overgeneralization — name each and explain why)\n\
             4. Open questions the author avoids or leaves undeveloped\n\
             5. Overall credibility assessment\n\n\
             Be specific and cite actual content from the document. Respond in Markdown."
        ),
        "explain" if zh => format!(
            "你是耐心的讲解者。请用{language}把这篇文档讲清楚，面向一个聪明但没有背景知识的读者：\n\
             1. 用通俗的语言解释这篇文档要解决的问题\n\
             2. 把关键概念逐个讲明白（必要时打比方）\n\
             3. 逐步拆解作者的核心推理过程\n\
             4. 指出哪些地方初学者最容易卡住，以及怎么理解\n\n\
             只依据文档内容。使用 Markdown 输出。"
        ),
        "explain" => format!(
            "Explain this document in {language} to a smart reader with no background:\n\
             1. What problem is the document addressing, in plain language\n\
             2. Walk through each key concept, using analogies where helpful\n\
             3. Break down the author's core reasoning step by step\n\
             4. Where a newcomer is most likely to get stuck, and how to get past it\n\n\
             Ground everything in the document. Respond in Markdown."
        ),
        _ if zh => format!(
            "你是文档问答助手。请用{language}回答用户关于这篇文档的问题。\n\
             要求：只依据文档内容作答；文档没有提到的内容要明确说明“文档未涉及”，不要凭常识补充。\
             回答要简洁准确，必要时引用原文。"
        ),
        _ => format!(
            "You are a document Q&A assistant. Answer the user's questions in {language}.\n\
             Ground every answer in the document. If the document does not cover something, say so explicitly rather than guessing.\
             Be concise and accurate; quote the source when useful."
        ),
    }
}

/// Compose the user-facing message that carries the document body.
pub fn build_user_message(req: &InterpretRequest) -> String {
    let title = req.document_title.as_deref().unwrap_or("未命名文档");
    let mut out = String::new();

    if req.mode == "qa" {
        out.push_str(&format!("以下是文档《{title}》的全文：\n\n<document>\n{}\n</document>\n\n", req.content));
        out.push_str("请基于以上文档回答。");
        if let Some(extra) = &req.instruction {
            if !extra.trim().is_empty() {
                out.push_str("\n\n额外要求：");
                out.push_str(extra);
            }
        }
        return out;
    }

    out.push_str(&format!("文档标题：{title}\n\n文档全文：\n\n<document>\n{}\n</document>", req.content));
    if let Some(extra) = &req.instruction {
        if !extra.trim().is_empty() {
            out.push_str("\n\n额外要求：");
            out.push_str(extra);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overview_prompt_is_localised() {
        let zh = mode_prompt("overview", "简体中文");
        assert!(zh.contains("简体中文"));
        assert!(zh.contains("核心论点"));

        let en = mode_prompt("overview", "English");
        assert!(en.contains("English"));
        assert!(en.contains("Core claims"));
        assert!(!en.contains("核心论点"));
    }

    #[test]
    fn chinese_detection_accepts_display_names_and_locales() {
        // Display names sent by the UI.
        assert!(is_chinese("简体中文"));
        assert!(is_chinese("繁體中文"));
        // API-style locale tags.
        assert!(is_chinese("zh-CN"));
        assert!(is_chinese("zh-TW"));
        // Anything else falls back to the English prompt.
        assert!(!is_chinese("English"));
        assert!(!is_chinese("日本語"));
        assert!(!is_chinese("Deutsch"));
    }

    #[test]
    fn every_mode_has_a_prompt() {
        for mode in ["overview", "outline", "critique", "explain", "qa", "unknown"] {
            let prompt = mode_prompt(mode, "简体中文");
            assert!(!prompt.is_empty(), "mode {mode} produced an empty prompt");
            assert!(prompt.contains("简体中文"), "mode {mode} lost the language");
        }
    }

    #[test]
    fn user_message_wraps_document_in_tags() {
        let req = InterpretRequest {
            request_id: "r1".into(),
            provider: "openai".into(),
            endpoint: None,
            model: None,
            api_key: None,
            mode: "overview".into(),
            language: "简体中文".into(),
            instruction: Some("重点讲讲第三章".into()),
            document_title: Some("测试文档".into()),
            content: "# 标题\n\n正文内容".into(),
            history: vec![],
            max_tokens: None,
            temperature: None,
        };
        let msg = build_user_message(&req);
        assert!(msg.contains("<document>"));
        assert!(msg.contains("</document>"));
        assert!(msg.contains("正文内容"));
        assert!(msg.contains("重点讲讲第三章"));
    }

    #[test]
    fn qa_message_includes_document_and_instruction() {
        let req = InterpretRequest {
            request_id: "r2".into(),
            provider: "ollama".into(),
            endpoint: None,
            model: None,
            api_key: None,
            mode: "qa".into(),
            language: "English".into(),
            instruction: Some("Summarise chapter 2".into()),
            document_title: None,
            content: "content here".into(),
            history: vec![],
            max_tokens: None,
            temperature: None,
        };
        let msg = build_user_message(&req);
        assert!(msg.contains("content here"));
        assert!(msg.contains("Summarise chapter 2"));
        assert!(msg.contains("未命名文档"));
    }
}
