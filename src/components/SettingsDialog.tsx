import { useState } from "react";
import { X, RotateCcw } from "lucide-react";
import { useSettings, ACCENTS, DEFAULT_SETTINGS, type ThemeMode } from "@/state/settings";
import { cn } from "@/lib/utils";

interface Props {
  onClose: () => void;
}

type Tab = "appearance" | "reading" | "markdown";

export default function SettingsDialog({ onClose }: Props) {
  const s = useSettings();
  const [tab, setTab] = useState<Tab>("appearance");

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">设置</span>
          <button className="btn-icon" onClick={() => s.reset()} title="恢复默认">
            <RotateCcw size={15} />
          </button>
          <button className="btn-icon" onClick={onClose} title="关闭 (Esc)">
            <X size={16} />
          </button>
        </div>

        <div className="settings-tabs">
          <button className={cn("settings-tab", tab === "appearance" && "active")} onClick={() => setTab("appearance")}>
            外观
          </button>
          <button className={cn("settings-tab", tab === "reading" && "active")} onClick={() => setTab("reading")}>
            阅读
          </button>
          <button className={cn("settings-tab", tab === "markdown" && "active")} onClick={() => setTab("markdown")}>
            渲染
          </button>
        </div>

        <div className="modal-body">
          {tab === "appearance" && (
            <>
              <div className="settings-group">
                <div className="settings-group-title">主题</div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">外观模式</div>
                    <div className="settings-row-desc">跟随系统或手动指定明暗</div>
                  </div>
                  <div className="segmented">
                    {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
                      <button
                        key={m}
                        className={cn(s.theme === m && "active")}
                        onClick={() => s.update("theme", m)}
                      >
                        {m === "light" ? "明亮" : m === "dark" ? "暗黑" : "跟随系统"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">强调色</div>
                    <div className="settings-row-desc">链接、引用、按钮的强调颜色</div>
                  </div>
                  <div className="swatches">
                    {ACCENTS.map((a) => (
                      <button
                        key={a.id}
                        className={cn("swatch", s.accent === a.id && "active")}
                        style={{ background: a.color }}
                        onClick={() => s.update("accent", a.id)}
                        title={a.label}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="settings-group">
                <div className="settings-group-title">界面</div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">显示侧边栏</div>
                    <div className="settings-row-desc">大纲、文件与最近打开</div>
                  </div>
                  <div className={cn("switch", s.showSidebar && "on")} onClick={() => s.update("showSidebar", !s.showSidebar)} />
                </div>
              </div>
            </>
          )}

          {tab === "reading" && (
            <>
              <div className="settings-group">
                <div className="settings-group-title">排版</div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">正文字号</div>
                    <div className="settings-row-desc">{s.readingFontSize} px</div>
                  </div>
                  <input
                    type="range"
                    min={13}
                    max={24}
                    step={1}
                    value={s.readingFontSize}
                    onChange={(e) => s.update("readingFontSize", Number(e.target.value))}
                    style={{ width: 160 }}
                  />
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">行高</div>
                    <div className="settings-row-desc">{s.readingLineHeight.toFixed(2)}</div>
                  </div>
                  <input
                    type="range"
                    min={1.4}
                    max={2.2}
                    step={0.05}
                    value={s.readingLineHeight}
                    onChange={(e) => s.update("readingLineHeight", Number(e.target.value))}
                    style={{ width: 160 }}
                  />
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">内容宽度</div>
                    <div className="settings-row-desc">{s.contentWidth} px</div>
                  </div>
                  <input
                    type="range"
                    min={600}
                    max={1100}
                    step={20}
                    value={s.contentWidth}
                    onChange={(e) => s.update("contentWidth", Number(e.target.value))}
                    style={{ width: 160 }}
                  />
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">正文字体</div>
                    <div className="settings-row-desc">衬线体更适合长文阅读</div>
                  </div>
                  <div className="segmented">
                    <button className={cn(s.fontFamily === "serif" && "active")} onClick={() => s.update("fontFamily", "serif")}>
                      衬线
                    </button>
                    <button className={cn(s.fontFamily === "sans" && "active")} onClick={() => s.update("fontFamily", "sans")}>
                      无衬线
                    </button>
                    <button className={cn(s.fontFamily === "mono" && "active")} onClick={() => s.update("fontFamily", "mono")}>
                      等宽
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-group">
                <div className="settings-group-title">阅读与 AI</div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">打开文档时显示 AI 面板</div>
                    <div className="settings-row-desc">适合经常用 AI 解读的场景</div>
                  </div>
                  <div className={cn("switch", s.aiAutoOpen && "on")} onClick={() => s.update("aiAutoOpen", !s.aiAutoOpen)} />
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">平滑滚动</div>
                    <div className="settings-row-desc">跳转标题时使用动画滚动</div>
                  </div>
                  <div className={cn("switch", s.smoothScroll && "on")} onClick={() => s.update("smoothScroll", !s.smoothScroll)} />
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">外部修改自动重载</div>
                    <div className="settings-row-desc">文件被其他程序修改时自动刷新</div>
                  </div>
                  <div className={cn("switch", s.autoReload && "on")} onClick={() => s.update("autoReload", !s.autoReload)} />
                </div>
              </div>
            </>
          )}

          {tab === "markdown" && (
            <>
              <div className="settings-group">
                <div className="settings-group-title">渲染能力</div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">代码高亮</div>
                    <div className="settings-row-desc">使用 Shiki 精确语法高亮，支持 30+ 语言</div>
                  </div>
                  <div className={cn("switch", s.codeHighlight && "on")} onClick={() => s.update("codeHighlight", !s.codeHighlight)} />
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">数学公式</div>
                    <div className="settings-row-desc">KaTeX 渲染 $…$ 与 $$…$$</div>
                  </div>
                  <div className={cn("switch", s.mathEnabled && "on")} onClick={() => s.update("mathEnabled", !s.mathEnabled)} />
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">图表</div>
                    <div className="settings-row-desc">Mermaid 流程图、时序图、甘特图</div>
                  </div>
                  <div className={cn("switch", s.diagramsEnabled && "on")} onClick={() => s.update("diagramsEnabled", !s.diagramsEnabled)} />
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">允许内联 HTML</div>
                    <div className="settings-row-desc">已内置安全过滤，会移除脚本与事件属性</div>
                  </div>
                  <div className={cn("switch", s.allowHtml && "on")} onClick={() => s.update("allowHtml", !s.allowHtml)} />
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">排版替换</div>
                    <div className="settings-row-desc">智能引号、省略号、破折号</div>
                  </div>
                  <div className={cn("switch", s.typographer && "on")} onClick={() => s.update("typographer", !s.typographer)} />
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">单个换行视为分段</div>
                    <div className="settings-row-desc">关闭后需空行才换段（标准 Markdown 行为）</div>
                  </div>
                  <div className={cn("switch", s.lineBreaks && "on")} onClick={() => s.update("lineBreaks", !s.lineBreaks)} />
                </div>
              </div>

              <div className="info-banner" style={{ marginTop: 16 }}>
                所有设置即时生效并自动保存。当前版本 {DEFAULT_SETTINGS.readingFontSize}px 为默认正文基准。
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <span style={{ fontSize: 11.5, color: "var(--text-tertiary)", flex: 1 }}>
            设置自动保存在本机
          </span>
          <button className="btn btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
