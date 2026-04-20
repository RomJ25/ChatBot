import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  FileText,
  Paperclip,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Square,
  UploadCloud,
  X,
} from "lucide-react";
import { Markdown } from "./components/Markdown";
import { createDefaultClient, LLMError, type ChatMessage } from "./llm";
import { TEAM } from "./content/team";
import { buildWelcome } from "./content/systemPrompt";

type Message = {
  id: number;
  sender: "bot" | "user";
  content: string;
  files?: File[];
  timestamp: string;
  streaming?: boolean;
  error?: boolean;
  excludeFromLlm?: boolean;
  llmContent?: string;
};

const WELCOME_CONTENT = buildWelcome();

const NOT_CONFIGURED_CONTENT = `⚙️ **לא הוגדרו פרטי ה-LLM.**

צור קובץ \`.env.local\` עם הערכים:

\`\`\`
VITE_LLM_BASE_URL=...
VITE_LLM_API_KEY=...
VITE_LLM_MODEL=...
\`\`\`

הקובץ \`.env.example\` כולל מספר הגדרות מוכנות לשימוש (OpenAI, Groq, Ollama, LM Studio, Anthropic ונקודת קצה פנימית). לאחר מכן הפעל מחדש את \`npm run dev\`.`;

const now = () =>
  new Date().toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
  });

const TEXT_FILE_RE =
  /\.(txt|md|markdown|json|jsonl|csv|tsv|log|ya?ml|toml|ini|conf|env|sh|bash|zsh|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|js|mjs|cjs|ts|tsx|jsx|html|htm|css|scss|less|xml|svg)$/i;

async function buildUserContent(text: string, files: File[]): Promise<string> {
  if (!files || files.length === 0) return text;
  const parts: string[] = [];
  if (text.trim()) parts.push(text);
  for (const f of files) {
    const isText = /^text\//.test(f.type) || TEXT_FILE_RE.test(f.name);
    if (isText) {
      try {
        const content = await f.text();
        const lang = (f.name.split(".").pop() ?? "").toLowerCase();
        parts.push(`📎 \`${f.name}\`:\n\n\`\`\`${lang}\n${content}\n\`\`\``);
      } catch {
        parts.push(`📎 \`${f.name}\` (שגיאה בקריאת הקובץ)`);
      }
    } else {
      parts.push(
        `📎 \`${f.name}\` (${f.type || "סוג לא ידוע"}) — תוכן הקובץ לא נקרא`,
      );
    }
  }
  return parts.join("\n\n");
}

export default function ChatBot() {
  const client = useMemo(() => createDefaultClient(), []);

  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: 1,
      sender: "bot",
      content: client ? WELCOME_CONTENT : NOT_CONFIGURED_CONTENT,
      timestamp: now(),
      excludeFromLlm: true,
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragCounter = useRef(0);

  const abortRef = useRef<AbortController | null>(null);
  const streamingIdRef = useRef<number | null>(null);
  const bufferRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const lastMouseRaf = useRef<number | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (lastMouseRaf.current !== null) return;
      lastMouseRaf.current = requestAnimationFrame(() => {
        setMousePos({ x: e.clientX, y: e.clientY });
        lastMouseRaf.current = null;
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  const handleScroll = () => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 80;
    setIsAtBottom(atBottom);
    setShowScrollButton(!atBottom);
  };

  const scrollToBottom = (force = false) => {
    const c = chatContainerRef.current;
    if (!c) return;
    if (force || isAtBottom) {
      c.scrollTop = c.scrollHeight;
    }
  };

  const scrollToBottomSmooth = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0)
      setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) setAttachedFiles((prev) => [...prev, ...files]);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const removeFile = (idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const scheduleFlush = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const chunk = bufferRef.current;
      const id = streamingIdRef.current;
      bufferRef.current = "";
      if (!chunk || id === null) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, content: m.content + chunk } : m,
        ),
      );
    });
  };

  const cancelFlush = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    bufferRef.current = "";
  };

  const ensureStreamingBubble = (): number => {
    if (streamingIdRef.current !== null) return streamingIdRef.current;
    const id = Date.now() + Math.floor(Math.random() * 1000) + 1;
    streamingIdRef.current = id;
    setMessages((prev) => [
      ...prev,
      {
        id,
        sender: "bot",
        content: "",
        streaming: true,
        timestamp: now(),
      },
    ]);
    return id;
  };

  const handleAbort = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const toLlmMessages = (list: Message[]): ChatMessage[] => {
    const out: ChatMessage[] = [];
    for (const m of list) {
      if (m.excludeFromLlm) continue;
      if (m.error) continue;
      if (!m.content || !m.content.trim()) continue;
      out.push({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.llmContent ?? m.content,
      });
    }
    return out;
  };

  const runStream = async (historyBase: Message[]) => {
    if (!client) return;

    const llmMessages = toLlmMessages(historyBase);
    if (llmMessages.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    streamingIdRef.current = null;
    bufferRef.current = "";
    setIsTyping(true);
    setIsStreaming(true);

    try {
      let gotAny = false;
      for await (const delta of client.stream(llmMessages, {
        signal: controller.signal,
      })) {
        if (!gotAny) {
          gotAny = true;
          setIsTyping(false);
          ensureStreamingBubble();
        }
        bufferRef.current += delta;
        scheduleFlush();
      }

      // Final flush of any pending buffer.
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      if (!gotAny) {
        // Server returned nothing. Surface a helpful fallback.
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + Math.floor(Math.random() * 1000) + 1,
            sender: "bot",
            content: "_(השרת החזיר תשובה ריקה)_",
            timestamp: now(),
            excludeFromLlm: true,
          },
        ]);
      } else {
        const pending = bufferRef.current;
        bufferRef.current = "";
        const id = streamingIdRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  content: pending ? m.content + pending : m.content,
                  streaming: false,
                }
              : m,
          ),
        );
      }
    } catch (err) {
      cancelFlush();
      const aborted =
        err instanceof LLMError && err.code === "aborted";
      const id = streamingIdRef.current ?? ensureStreamingBubble();

      if (aborted) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  streaming: false,
                  content: m.content || "_(הופסק על ידי המשתמש)_",
                }
              : m,
          ),
        );
      } else {
        const errText =
          err instanceof LLMError
            ? describeError(err)
            : `שגיאה בלתי צפויה:\n\n\`\`\`\n${String((err as any)?.message ?? err)}\n\`\`\``;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== id) return m;
            const partial = m.content?.trim();
            const content = partial
              ? `${m.content}\n\n---\n\n${errText}`
              : errText;
            return {
              ...m,
              content,
              streaming: false,
              error: true,
              excludeFromLlm: true,
            };
          }),
        );
      }
    } finally {
      setIsTyping(false);
      setIsStreaming(false);
      abortRef.current = null;
      streamingIdRef.current = null;
    }
  };

  const handleSend = async (overrideText?: string) => {
    if (isStreaming) return;
    if (!client) return;
    const query = typeof overrideText === "string" ? overrideText : inputValue;
    const hasFiles = attachedFiles.length > 0;
    if (!query.trim() && !hasFiles) return;

    const currentFiles = [...attachedFiles];
    const userMsg: Message = {
      id: Date.now(),
      sender: "user",
      content: query,
      files: currentFiles,
      timestamp: now(),
    };

    // Show user message instantly.
    const visibleHistory = [...messages, userMsg];
    setMessages(visibleHistory);
    setInputValue("");
    setAttachedFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setTimeout(() => scrollToBottom(true), 50);

    // Build LLM content (reads attached text files); may take a tick.
    const llmContent = await buildUserContent(query, currentFiles);
    // Persist llmContent on the user message so retries preserve file contents.
    setMessages((prev) =>
      prev.map((m) => (m.id === userMsg.id ? { ...m, llmContent } : m)),
    );
    const historyForLlm = visibleHistory.map((m) =>
      m.id === userMsg.id ? { ...m, llmContent } : m,
    );

    await runStream(historyForLlm);
  };

  const handleRetryFrom = (errorId: number) => {
    const idx = messages.findIndex((m) => m.id === errorId);
    if (idx < 0) return;
    // Build the history up through the user message that preceded this error.
    let userIdx = idx - 1;
    while (userIdx >= 0 && messages[userIdx].sender !== "user") userIdx--;
    if (userIdx < 0) return;
    const historyForRetry = messages.slice(0, userIdx + 1);
    // Remove just the error bubble; keep everything else. New response appends at the end.
    const kept = messages.filter((m) => m.id !== errorId);
    setMessages(kept);
    setTimeout(() => void runStream(historyForRetry), 0);
  };

  // Only show retry when this error is the most recent bubble, so retrying
  // never overwrites or confuses a later conversation turn.
  const isLatest = (id: number) => messages[messages.length - 1]?.id === id;

  const showConfigHintInHeader = !client;

  return (
    <div
      dir="rtl"
      className="min-h-screen relative overflow-hidden font-heebo"
      style={{ backgroundColor: "#eef2f7" }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
        ::selection { background: rgba(37, 99, 235, 0.15); color: #0f172a; text-shadow: none; }
        .font-heebo { font-family: 'Heebo', ui-sans-serif, system-ui, "Segoe UI", "Arial Hebrew", Arial, sans-serif; letter-spacing: -0.012em; }

        :root {
          --ease-fluid: cubic-bezier(0.2, 0.8, 0.2, 1);
          --ease-out-quick: cubic-bezier(0.16, 1, 0.3, 1);
        }

        .hw-accelerate {
          will-change: transform, opacity, filter;
          backface-visibility: hidden;
          transform: translateZ(0);
        }

        .spotlight-card { position: relative; }
        .spotlight-card::before {
          content: ""; position: absolute; inset: 0;
          background: radial-gradient(400px circle at var(--mouse-x, 0) var(--mouse-y, 0), rgba(255,255,255,0.7), transparent 40%);
          opacity: 0; transition: opacity 0.3s var(--ease-fluid); pointer-events: none; z-index: 2; border-radius: inherit;
        }
        .spotlight-card:hover::before { opacity: 1; }

        .premium-prose { max-width: 65ch; }
        .premium-prose:hover p, .premium-prose:hover ul, .premium-prose:hover ol, .premium-prose:hover blockquote { color: #7f90a8; text-shadow: none; transition: color 0.4s var(--ease-fluid); }
        .premium-prose p:hover, .premium-prose ul:hover, .premium-prose ol:hover, .premium-prose blockquote:hover { color: #0f172a; text-shadow: 0px 4px 12px rgba(15, 23, 42, 0.05), 0px 1px 0px rgba(255, 255, 255, 0.85); transition: color 0.15s var(--ease-fluid); }
        .premium-prose p { margin-bottom: 1.35em; line-height: 1.7; font-size: 15.5px; transition: color 0.4s var(--ease-fluid); }
        .premium-prose p:last-child { margin-bottom: 0; }

        .premium-prose strong {
          font-weight: 600; color: inherit; background: linear-gradient(120deg, rgba(37,99,235,0.08) 0%, rgba(37,99,235,0.02) 100%);
          padding: 0.1em 0.35em; border-radius: 6px; box-shadow: inset 0 -1px 0 rgba(37,99,235,0.15), 0 2px 4px rgba(37,99,235,0.03);
          letter-spacing: -0.01em; margin: 0 0.1em; transition: color 0.4s var(--ease-fluid);
        }
        .premium-prose p:hover strong, .premium-prose ul:hover strong, .premium-prose ol:hover strong { color: #0f172a; }

        .premium-prose code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.85em; color: #2563eb; background: rgba(37, 99, 235, 0.06);
          border: 1px solid rgba(37, 99, 235, 0.12); padding: 0.2em 0.4em; border-radius: 6px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.8); margin: 0 0.1em; letter-spacing: 0;
        }
        /* Reset inline-code styling when inside a block (<pre>) */
        .premium-prose pre code {
          color: inherit; background: transparent; border: 0; padding: 0; border-radius: 0;
          box-shadow: none; font-size: 13px; margin: 0;
        }

        .premium-prose blockquote {
          margin: 1.8em 0; padding: 0.8em 1.2em 0.8em 0; border-right: 3px solid rgba(37, 99, 235, 0.4);
          background: linear-gradient(90deg, transparent, rgba(37, 99, 235, 0.03)); border-radius: 4px;
          font-style: italic; font-size: 16px; line-height: 1.6; color: inherit; transition: all 0.4s var(--ease-fluid);
        }
        .premium-prose blockquote:hover { border-right-color: #2563eb; background: linear-gradient(90deg, transparent, rgba(37, 99, 235, 0.06)); }

        .premium-prose ul { margin-top: 1.5em; margin-bottom: 1.5em; padding-right: 1.5em; list-style: none; transition: color 0.4s var(--ease-fluid); }
        .premium-prose li { position: relative; margin-bottom: 1em; line-height: 1.65; font-size: 15.5px; }
        .premium-prose li:last-child { margin-bottom: 0; }
        .premium-prose ul li::before {
          content: ""; position: absolute; right: -1.4em; top: 0.65em; width: 6px; height: 6px;
          border-radius: 50%; background: #2563eb; box-shadow: 0 0 10px rgba(37,99,235,0.6), inset 0 1px 2px rgba(255,255,255,0.8);
          transition: all 0.4s var(--ease-fluid);
        }
        .premium-prose:hover ul:not(:hover) li::before { background: #7f90a8; box-shadow: none; }

        .text-ink {
          color: #0f172a; text-shadow: 0px 4px 12px rgba(15, 23, 42, 0.05), 0px 1px 0px rgba(255, 255, 255, 0.85);
          -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility;
        }

        .ink-settle { animation: inkSettle 0.5s var(--ease-fluid) forwards; opacity: 0; will-change: transform, filter, opacity, letter-spacing; }
        @keyframes inkSettle {
          0% { filter: blur(5px); opacity: 0; transform: translate3d(0, 8px, 0); color: #435569; letter-spacing: -0.02em; }
          100% { filter: blur(0); opacity: 1; transform: translate3d(0, 0, 0); color: #0f172a; letter-spacing: -0.012em; }
        }

        .specular-highlight::before {
          content: ""; position: absolute; top: 0; left: 10%; right: 10%; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,1) 50%, transparent); opacity: 0.9; pointer-events: none; z-index: 5;
        }

        .glass-panel {
          position: relative; background: linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(248, 250, 255, 0.8) 100%);
          backdrop-filter: blur(30px) saturate(1.4); -webkit-backdrop-filter: blur(30px) saturate(1.4); border: 1px solid rgba(255, 255, 255, 0.85);
          box-shadow: 0 16px 40px -8px rgba(15, 23, 42, 0.04), inset 0px 1px 1px rgba(255, 255, 255, 1), inset 0px -1px 2px rgba(37, 99, 235, 0.03);
          transition: transform 0.3s var(--ease-fluid), box-shadow 0.3s var(--ease-fluid), border-color 0.3s var(--ease-fluid); overflow: hidden;
        }
        .glass-panel::after {
          content: ""; position: absolute; inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
          opacity: 0.02; mix-blend-mode: overlay; pointer-events: none; z-index: 0;
        }
        .glass-panel > * { position: relative; z-index: 1; }
        .glass-panel:hover {
          box-shadow: 0 24px 60px -12px rgba(37, 99, 235, 0.08), inset 0px 2px 3px rgba(255, 255, 255, 1), inset 0px -1px 2px rgba(37, 99, 235, 0.05);
          border-color: rgba(255, 255, 255, 1); transition: all 0.15s var(--ease-out-quick);
        }

        .bot-bubble {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(240, 246, 255, 0.85) 100%);
          box-shadow: 0 16px 40px -8px rgba(15, 23, 42, 0.04), inset 0px 1px 1px rgba(255, 255, 255, 1), inset 1px 0px 20px rgba(37, 99, 235, 0.04);
        }
        .bot-bubble.error-bubble {
          background: linear-gradient(135deg, rgba(254, 242, 242, 0.98) 0%, rgba(254, 226, 226, 0.7) 100%);
          box-shadow: 0 16px 40px -8px rgba(239, 68, 68, 0.06), inset 0px 1px 1px rgba(255, 255, 255, 1), inset 1px 0px 20px rgba(239, 68, 68, 0.05);
        }

        .glass-input-focused {
          background: rgba(255, 255, 255, 1) !important;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15), 0 24px 60px rgba(37, 99, 235, 0.1), inset 0 1px 3px rgba(255, 255, 255, 1) !important;
          border-color: rgba(37, 99, 235, 0.5) !important; transform: translate3d(0, -2px, 0); transition: all 0.4s var(--ease-fluid);
        }

        .glass-chip {
          position: relative; background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(255, 255, 255, 0.7);
          box-shadow: 0 4px 15px rgba(15, 23, 42, 0.02), inset 0 1px 1px rgba(255,255,255,0.9); transition: all 0.3s var(--ease-fluid); overflow: hidden; cursor: pointer;
        }
        .glass-chip:hover {
          background: rgba(255, 255, 255, 0.98); transform: translate3d(0, -3px, 0) scale3d(1.02, 1.02, 1);
          box-shadow: 0 12px 30px rgba(37, 99, 235, 0.08), 0 0 0 1px rgba(37, 99, 235, 0.2), inset 0 1px 2px rgba(255,255,255,1); transition: all 0.15s var(--ease-out-quick);
        }
        .glass-chip:active {
          transform: translate3d(0, -1px, 0) scale3d(0.96, 0.96, 1); box-shadow: 0 4px 15px rgba(37, 99, 235, 0.05), inset 0 1px 1px rgba(255,255,255,0.9); transition: all 0.1s ease-out;
        }

        .bot-message-enter { animation: glassMaterialize 0.5s var(--ease-fluid) forwards; }
        .user-message-enter { animation: slideRightFade 0.5s var(--ease-fluid) forwards; }

        @keyframes glassMaterialize {
          0% { opacity: 0; transform: translate3d(0, 15px, 0) scale3d(0.96, 0.96, 1); filter: blur(10px); }
          100% { opacity: 1; transform: translate3d(0, 0, 0) scale3d(1, 1, 1); filter: blur(0); }
        }
        @keyframes slideRightFade {
          0% { opacity: 0; transform: translate3d(20px, 0, 0) scale3d(0.98, 0.98, 1); filter: blur(5px); }
          100% { opacity: 1; transform: translate3d(0, 0, 0) scale3d(1, 1, 1); filter: blur(0); }
        }

        @keyframes aurora-flow {
          0% { transform: translate3d(0, 0, 0) scale3d(1, 1, 1) rotate(0deg); opacity: 0.5; }
          33% { transform: translate3d(5vw, -8vh, 0) scale3d(1.2, 1.2, 1) rotate(10deg); opacity: 0.7; }
          66% { transform: translate3d(-3vw, 5vh, 0) scale3d(0.9, 0.9, 1) rotate(-5deg); opacity: 0.6; }
          100% { transform: translate3d(0, 0, 0) scale3d(1, 1, 1) rotate(0deg); opacity: 0.5; }
        }
        .aurora-blob { position: absolute; border-radius: 50%; filter: blur(120px); animation: aurora-flow 25s infinite ease-in-out alternate; z-index: 0; pointer-events: none; will-change: transform; }
        .icon-glow { filter: drop-shadow(0px 4px 8px rgba(37, 99, 235, 0.4)); }
        .icon-glow-strong { filter: drop-shadow(0px 0px 12px rgba(37, 99, 235, 0.6)); }

        .text-etched { text-shadow: 0px 1px 0px rgba(255, 255, 255, 0.9); }

        .chat-scroll-mask {
          mask-image: linear-gradient(to bottom, transparent 0%, black 6%, black 100%);
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 6%, black 100%);
        }

        @keyframes slideUpFade {
          0% { opacity: 0; transform: translate3d(0, 10px, 0); }
          100% { opacity: 1; transform: translate3d(0, 0, 0); }
        }

        @keyframes organicPulse {
          0%, 100% { transform: scale3d(0.8, 0.8, 1); opacity: 0.4; }
          50% { transform: scale3d(1.1, 1.1, 1); opacity: 1; }
        }

        @keyframes caretBlink {
          0%, 50% { opacity: 1; }
          50.01%, 100% { opacity: 0; }
        }
        .stream-caret {
          display: inline-block; width: 2px; height: 1.05em; vertical-align: -0.15em;
          margin-right: 3px; background: #2563eb; border-radius: 1px;
          box-shadow: 0 0 8px rgba(37, 99, 235, 0.7), 0 0 2px rgba(37, 99, 235, 0.9);
          animation: caretBlink 1s steps(2) infinite;
        }

        .send-btn-active {
          box-shadow: 0 10px 30px -5px rgba(37, 99, 235, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.5);
          transition: all 0.3s var(--ease-fluid);
        }
        .send-btn-active:active {
          transform: scale3d(0.9, 0.9, 1); box-shadow: 0 4px 15px -2px rgba(37, 99, 235, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.2); transition: all 0.1s ease-out;
        }

        .stop-btn {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: white;
          box-shadow: 0 10px 30px -5px rgba(239, 68, 68, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.4);
          transition: all 0.2s var(--ease-fluid);
        }
        .stop-btn:hover { transform: scale3d(1.05, 1.05, 1); }
        .stop-btn:active { transform: scale3d(0.92, 0.92, 1); }

        .drag-overlay { backdrop-filter: blur(12px); transition: all 0.4s var(--ease-fluid); }

        .glass-input textarea::-webkit-scrollbar { width: 4px; }
        .glass-input textarea::-webkit-scrollbar-track { background: transparent; }
        .glass-input textarea::-webkit-scrollbar-thumb { background: rgba(37, 99, 235, 0.2); border-radius: 4px; }
        .glass-input textarea::-webkit-scrollbar-thumb:hover { background: rgba(37, 99, 235, 0.4); }

        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(127, 144, 168, 0.2); border-radius: 10px; border: 2px solid #eef2f7; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(127, 144, 168, 0.4); }
      `,
        }}
      />

      <div className="absolute inset-0 overflow-hidden pointer-events-none mix-blend-multiply opacity-80">
        <div
          className="aurora-blob hw-accelerate w-[900px] h-[600px] bg-[#2563eb]/[0.04] top-[-15%] right-[-20%]"
          style={{ animationDuration: "30s" }}
        />
        <div
          className="aurora-blob hw-accelerate w-[1000px] h-[700px] bg-[#60a5fa]/[0.03] bottom-[-20%] left-[-20%]"
          style={{ animationDuration: "35s", animationDelay: "-10s" }}
        />
        <div
          className="aurora-blob hw-accelerate w-[600px] h-[500px] bg-white/[0.6] top-[30%] left-[20%]"
          style={{ animationDuration: "20s", filter: "blur(100px)" }}
        />
      </div>

      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-1000 mix-blend-overlay z-0 hw-accelerate"
        style={{
          background: `radial-gradient(800px circle at ${mousePos.x}px ${mousePos.y}px, rgba(255, 255, 255, 0.4), transparent 50%)`,
        }}
      />

      <div className="absolute top-0 left-0 w-full h-[30vh] bg-gradient-to-b from-[#eef2f7] to-transparent z-10 pointer-events-none opacity-90 hw-accelerate" />

      <div
        className="relative z-20 max-w-4xl mx-auto h-screen flex flex-col px-4 py-8"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <header className="flex items-center justify-between mb-8 px-2 bot-message-enter hw-accelerate shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full glass-panel flex items-center justify-center relative">
              <Sparkles className="w-5 h-5 text-[#2563eb] icon-glow" />
              <div className="absolute top-0 right-0 w-2.5 h-2.5 bg-[#2563eb] rounded-full border-2 border-white shadow-[0_0_8px_rgba(37,99,235,0.4)]" />
            </div>
            <div>
              <h1 className="text-[#0f172a] font-semibold text-[17px] leading-tight tracking-tight">
                העוזר החכם של {TEAM.name}
              </h1>
              <p className="text-[#7f90a8] text-[13px] font-medium text-etched">
                {isStreaming
                  ? "מזרים תשובה…"
                  : showConfigHintInHeader
                    ? "ממתין להגדרת LLM"
                    : "מחובר ומוכן"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="px-3 py-1.5 rounded-full glass-panel text-[#435569] text-xs font-semibold flex items-center gap-1.5 shadow-sm">
              <span
                className={`w-1.5 h-1.5 rounded-full block ${
                  showConfigHintInHeader
                    ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]"
                    : isStreaming
                      ? "bg-blue-500 shadow-[0_0_6px_rgba(37,99,235,0.7)] animate-pulse"
                      : "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]"
                }`}
              />
              {showConfigHintInHeader
                ? "דרושה הגדרה"
                : isStreaming
                  ? "מזרים"
                  : "מערכת יציבה"}
            </div>
          </div>
        </header>

        <div
          ref={chatContainerRef}
          onScroll={handleScroll}
          aria-live="polite"
          className={`flex-1 overflow-y-auto mb-6 px-2 pb-4 relative z-10 space-y-7 chat-scroll-mask transition-all duration-700 ease-in-out hw-accelerate ${isInputFocused ? "opacity-40 blur-[2px]" : "opacity-100 blur-0"}`}
        >
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex w-full hw-accelerate ${msg.sender === "user" ? "justify-end user-message-enter" : "justify-start bot-message-enter"}`}
            >
              {msg.sender === "bot" ? (
                <div className="flex gap-4 max-w-[85%]">
                  <div className="w-8 h-8 rounded-full bg-white/60 border border-white/80 shadow-md flex items-center justify-center flex-shrink-0 mt-1 backdrop-blur-md">
                    <Sparkles className="w-4 h-4 text-[#2563eb] icon-glow" />
                  </div>
                  <div className="space-y-3 w-full">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-semibold text-[#435569] text-etched">
                        {msg.error ? "הודעת מערכת" : "מערכת פנימית"}
                      </span>
                      <span className="text-[10px] text-[#7f90a8] text-etched font-medium">
                        {msg.timestamp}
                      </span>
                    </div>

                    <div
                      className={`glass-panel bot-bubble specular-highlight hw-accelerate rounded-[24px] rounded-tr-[8px] px-7 py-6 inline-block relative group shadow-[0_20px_40px_-12px_rgba(15,23,42,0.06)] hover:shadow-[0_24px_50px_-10px_rgba(15,23,42,0.08)] max-w-[95%] ${msg.error ? "error-bubble" : ""}`}
                    >
                      <div className="absolute inset-0 bg-gradient-to-b from-white/60 to-transparent pointer-events-none rounded-[24px] rounded-tr-[8px]" />
                      <div
                        className={`absolute right-0 top-6 bottom-6 w-[3px] rounded-l-full opacity-60 group-hover:opacity-100 transition-opacity duration-500 ${msg.error ? "bg-gradient-to-b from-red-500/60 to-red-500/10 shadow-[0_0_8px_rgba(239,68,68,0.3)]" : "bg-gradient-to-b from-[#2563eb]/60 to-[#2563eb]/10 shadow-[0_0_8px_rgba(37,99,235,0.3)]"}`}
                      />
                      <div className="relative z-10 pr-2">
                        <Markdown>{msg.content || " "}</Markdown>
                        {msg.streaming && <span className="stream-caret" />}
                      </div>
                    </div>

                    {msg.error && isLatest(msg.id) && (
                      <button
                        onClick={() => handleRetryFrom(msg.id)}
                        className="glass-chip px-4 py-2 rounded-full text-[13px] font-medium text-[#435569] inline-flex items-center gap-2 hw-accelerate"
                        aria-label="נסה שוב"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-[#2563eb]" />
                        נסה שוב
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="max-w-[75%] flex flex-col items-end">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-[#7f90a8] text-etched font-medium">
                      {msg.timestamp}
                    </span>
                    <span className="text-[12px] font-semibold text-[#435569] text-etched">
                      את/ה
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-2 w-full">
                    {msg.files && msg.files.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-end w-full">
                        {msg.files.map((file, i) => (
                          <div
                            key={i}
                            className="glass-panel px-3 py-2 rounded-xl flex items-center gap-2 text-[#0f172a] bg-white/60 backdrop-blur-xl hw-accelerate"
                          >
                            <FileText className="w-4 h-4 text-[#2563eb]" />
                            <span
                              className="text-[13px] font-medium max-w-[150px] truncate text-etched"
                              dir="ltr"
                            >
                              {file.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.content && (
                      <div className="bg-gradient-to-br from-[#2563eb]/[0.08] to-[#2563eb]/[0.01] border border-[#2563eb]/20 rounded-[22px] rounded-tl-[6px] px-6 py-5 inline-block shadow-[inset_0_1px_2px_rgba(255,255,255,0.7),_0_8px_20px_-5px_rgba(37,99,235,0.05)] backdrop-blur-xl relative overflow-hidden specular-highlight hw-accelerate">
                        <p className="text-ink text-[15.5px] leading-[1.65] font-medium relative z-10 whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {isTyping && (
            <div className="flex gap-4 max-w-[85%] bot-message-enter justify-start hw-accelerate">
              <div className="w-8 h-8 rounded-full bg-white/60 border border-white/80 shadow-md flex items-center justify-center flex-shrink-0 mt-1 backdrop-blur-md">
                <Sparkles className="w-4 h-4 text-[#2563eb] icon-glow" />
              </div>
              <div className="glass-panel bot-bubble rounded-2xl rounded-tr-sm px-5 py-4 flex items-center gap-2 hw-accelerate">
                <div
                  className="w-2 h-2 rounded-full bg-[#2563eb] shadow-[0_0_8px_rgba(37,99,235,0.6)]"
                  style={{
                    animation: "organicPulse 1s ease-in-out infinite",
                    animationDelay: "0ms",
                  }}
                />
                <div
                  className="w-2 h-2 rounded-full bg-[#2563eb] shadow-[0_0_8px_rgba(37,99,235,0.6)]"
                  style={{
                    animation: "organicPulse 1s ease-in-out infinite",
                    animationDelay: "150ms",
                  }}
                />
                <div
                  className="w-2 h-2 rounded-full bg-[#2563eb] shadow-[0_0_8px_rgba(37,99,235,0.6)]"
                  style={{
                    animation: "organicPulse 1s ease-in-out infinite",
                    animationDelay: "300ms",
                  }}
                />
                <span className="text-[#2563eb] text-[13px] font-semibold mr-3 text-etched">
                  המערכת חושבת...
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} className="h-2" />
        </div>

        {showScrollButton && (
          <button
            onClick={scrollToBottomSmooth}
            className="absolute bottom-32 right-1/2 translate-x-1/2 z-40 glass-panel rounded-full p-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.1)] hover:scale-105 active:scale-95 transition-all duration-300"
            style={{ animation: "slideUpFade 0.3s ease-out" }}
            aria-label="גלול למטה"
          >
            <ArrowDown className="w-5 h-5 text-[#2563eb] icon-glow" />
          </button>
        )}

        {isDragging && (
          <div className="absolute inset-0 z-50 drag-overlay flex items-center justify-center bg-white/30 rounded-3xl m-4 border-[3px] border-dashed border-[#2563eb]/40 shadow-[inset_0_0_100px_rgba(37,99,235,0.1)] hw-accelerate">
            <div
              className="glass-panel p-12 rounded-[2rem] flex flex-col items-center gap-5 transform scale-105 shadow-[0_30px_60px_-15px_rgba(37,99,235,0.2)] border border-white hw-accelerate"
              style={{ animation: "slideUpFade 0.3s ease-out" }}
            >
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#2563eb]/10 to-[#3b82f6]/5 flex items-center justify-center border border-white/50 shadow-[0_0_30px_rgba(37,99,235,0.2)]">
                <UploadCloud className="w-12 h-12 text-[#2563eb] icon-glow-strong" />
              </div>
              <h2 className="text-[#0f172a] text-[20px] font-semibold mt-2 tracking-tight">
                שחרר קבצים כאן
              </h2>
              <p className="text-[#435569] text-[14px] font-medium text-center leading-snug">
                המסמכים יצורפו להודעה הבאה שלך
                <br />
                וייקראו על ידי המודל.
              </p>
            </div>
          </div>
        )}

        <div className="relative z-20 pt-2 pb-6 px-2 hw-accelerate shrink-0">
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              "מי מפקד/ת הצוות?",
              "אילו פרויקטים קיימים?",
              "ספר על חברי הצוות",
              "על מה הצוות מתמקד?",
            ].map((chip, idx) => (
              <button
                key={idx}
                onClick={() => void handleSend(chip)}
                disabled={isStreaming || !client}
                className="glass-chip px-4 py-2 rounded-full text-[13px] font-medium text-[#435569] flex items-center gap-2 tracking-tight hw-accelerate disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Search className="w-3.5 h-3.5 text-[#2563eb]/80 icon-glow" />
                {chip}
              </button>
            ))}
          </div>

          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3 px-2 bot-message-enter hw-accelerate">
              {attachedFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="glass-panel pl-2 pr-3 py-1.5 rounded-full flex items-center gap-2 bg-white/80 border-[#2563eb]/20 shadow-[0_4px_10px_rgba(37,99,235,0.05)]"
                >
                  <FileText className="w-3.5 h-3.5 text-[#2563eb] icon-glow" />
                  <span
                    className="text-[13px] font-medium text-[#0f172a] max-w-[120px] truncate"
                    dir="ltr"
                  >
                    {file.name}
                  </span>
                  <button
                    onClick={() => removeFile(idx)}
                    className="w-5 h-5 rounded-full hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors text-[#7f90a8]"
                    aria-label={`הסר ${file.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            className={`glass-panel hw-accelerate rounded-[30px] p-2 flex items-end gap-2 transition-all duration-300 relative overflow-hidden bg-white/60 ${isInputFocused ? "glass-input-focused" : ""}`}
          >
            <label
              className="w-11 h-11 mb-0.5 rounded-full flex items-center justify-center bg-transparent text-[#7f90a8] hover:bg-[#2563eb]/10 hover:text-[#2563eb] transition-colors shrink-0 relative overflow-hidden group active:scale-90 cursor-pointer"
              title="צרף קובץ"
            >
              <Paperclip className="w-5 h-5 group-hover:scale-110 transition-transform group-hover:icon-glow" />
              <input
                type="file"
                multiple
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => {
                  const list = e.target.files;
                  if (list && list.length) {
                    setAttachedFiles((prev) => [...prev, ...Array.from(list)]);
                  }
                  e.target.value = "";
                }}
                aria-label="צרף קובץ"
              />
            </label>

            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInput}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              onKeyDown={handleKeyDown}
              placeholder="שאל משהו…"
              className="flex-1 bg-transparent border-none outline-none text-[#0f172a] placeholder:text-[#7f90a8] text-[15px] font-medium px-2 py-3.5 leading-relaxed resize-none overflow-y-auto"
              rows={1}
              style={{ maxHeight: "150px" }}
              dir="rtl"
              aria-label="הקלד הודעה"
            />

            {isStreaming ? (
              <button
                onClick={handleAbort}
                className="w-12 h-12 mb-0.5 rounded-full flex items-center justify-center shrink-0 stop-btn"
                aria-label="עצור זרימה"
                title="עצור"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={() => void handleSend()}
                disabled={
                  !client ||
                  (!inputValue.trim() && attachedFiles.length === 0)
                }
                className={`w-12 h-12 mb-0.5 rounded-full flex items-center justify-center shrink-0 ${
                  client && (inputValue.trim() || attachedFiles.length > 0)
                    ? "bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white send-btn-active"
                    : "bg-[#0f172a]/5 text-[#7f90a8] cursor-not-allowed"
                }`}
                aria-label="שלח הודעה"
              >
                <Send
                  className="w-5 h-5 -ml-1"
                  style={{ transform: "rotate(180deg)" }}
                />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function describeError(err: LLMError): string {
  if (err.code === "http" && err.status === 401) {
    return `🔒 **אימות נכשל (401).**\n\nבדוק שהערך \`VITE_LLM_API_KEY\` נכון עבור הספק שבחרת.\n\n\`\`\`\n${err.message}\n\`\`\``;
  }
  if (err.code === "http" && err.status === 404) {
    return `❓ **לא נמצא (404).**\n\nככל הנראה הדגם \`VITE_LLM_MODEL\` לא קיים או ש-\`VITE_LLM_BASE_URL\` שגוי.\n\n\`\`\`\n${err.message}\n\`\`\``;
  }
  if (err.code === "http" && err.status === 429) {
    return `⏳ **חרגת ממגבלת הקצב (429).**\n\nחכה רגע ונסה שוב, או החלף ספק/דגם.\n\n\`\`\`\n${err.message}\n\`\`\``;
  }
  if (err.code === "http") {
    return `⚠️ **שגיאת HTTP ${err.status ?? ""}.**\n\n\`\`\`\n${err.message}\n\`\`\``;
  }
  if (err.code === "network") {
    return `🌐 **שגיאת רשת.**\n\nייתכן שחסרות כותרות CORS בנקודת הקצה. שקול להשתמש ב-proxy של Vite על ידי הגדרת \`LLM_UPSTREAM\` ב-\`.env.local\` ושימוש ב-\`VITE_LLM_BASE_URL=/api/llm\`.\n\n\`\`\`\n${err.message}\n\`\`\``;
  }
  if (err.code === "parse") {
    return `🧩 **לא הצלחתי לפענח את תשובת השרת.**\n\n\`\`\`\n${err.message}\n\`\`\``;
  }
  return `שגיאה:\n\n\`\`\`\n${err.message}\n\`\`\``;
}
