import { useEffect, useState } from "react";
import { X, ExternalLink, Github, Heart, Info } from "lucide-react";
import { bridge, type AppInfo } from "@/lib/bridge";

interface Props {
  onClose: () => void;
}

/** Where the project lives. Kept in one place so the UI and README agree. */
const REPO_URL = "https://github.com/inku2333/MarkThink";
const AUTHOR_URL = "https://github.com/inku2333";
const AUTHOR_NAME = "云间Yuki";

export default function AboutDialog({ onClose }: Props) {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (!bridge.available) return;
    void bridge
      .appInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const open = (url: string) => void bridge.openExternal(url);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal about-modal">
        <div className="modal-header">
          <Info size={16} style={{ color: "var(--accent)" }} />
          <span className="modal-title">关于 MarkThink</span>
          <button className="btn-icon" onClick={onClose} title="关闭 (Esc)">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body about-body">
          <div className="about-hero">
            <div className="about-logo">
              <Github size={30} strokeWidth={1.7} />
            </div>
            <div>
              <div className="about-name">MarkThink</div>
              <div className="about-version">
                版本 {info?.version ?? "0.1.0"}
                {info?.platform ? ` · ${info.platform}/${info.arch}` : ""}
              </div>
            </div>
          </div>

          <p className="about-desc">
            一个现代、简约、优雅的 Markdown 阅读器，让 AI 陪你读懂每一篇文档。
          </p>

          <div className="about-license">
            <span className="about-badge">MIT License</span>
            <span className="about-license-text">
              本项目是开源软件，遵循 MIT 许可协议，可自由使用、修改与分发。
            </span>
          </div>

          <div className="about-links">
            <button className="about-link" onClick={() => open(REPO_URL)}>
              <Github size={15} />
              <span className="about-link-label">项目主页</span>
              <span className="about-link-url">github.com/inku2333/MarkThink</span>
              <ExternalLink size={13} />
            </button>

            <button className="about-link" onClick={() => open(AUTHOR_URL)}>
              <Github size={15} />
              <span className="about-link-label">作者</span>
              <span className="about-link-url">{AUTHOR_NAME} · github.com/inku2333</span>
              <ExternalLink size={13} />
            </button>
          </div>

          <div className="about-footer-note">
            如果这个项目对你有帮助，欢迎在 GitHub 上点个 Star
            <Heart size={12} style={{ color: "var(--accent)" }} />
          </div>
        </div>

        <div className="modal-footer">
          <span style={{ fontSize: 11.5, color: "var(--text-tertiary)", flex: 1 }}>
            © 2026 {AUTHOR_NAME}
          </span>
          <button className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
