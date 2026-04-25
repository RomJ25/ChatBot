import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  FileText,
  MessageCircle,
  Paperclip,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  UploadCloud,
  X,
} from "lucide-react";
import { Markdown } from "./components/Markdown";
import { createDefaultClient, LLMError, type ChatMessage } from "./llm";

export type ChatSuggestion = { label: string; prompt: string };

export type ChatBotProps = {
  /** Header title, e.g. "העוזר החכם של צוות שניר". */
  headline: string;
  /** URL/path to a logo image. When set, replaces the default Sparkles icon in the header. */
  logoUrl?: string;
  /**
   * URL/path to a hero image rendered inside the welcome bubble (above the
   * Markdown welcome text). When unset, no hero is shown.
   */
  welcomeHeroUrl?: string;
  /**
   * Reveal cadence for streamed responses.
   *   "frame" — current behavior, ~60 React flushes/sec, snappy.
   *   "quill" — paced char-class-aware reveal with punctuation pauses.
   * Defaults to "frame". Honors prefers-reduced-motion (forces "frame").
   */
  cadence?: "frame" | "quill";
  /** Pre-built system prompt. The app composes this from its own content. */
  systemPrompt: string;
  /** Pre-built welcome message (Markdown). Shown as the first bot bubble. */
  welcome: string;
  /** Suggestion chips shown above the input. Rendered in order. */
  suggestions: ChatSuggestion[];
  /**
   * When true, the first paragraph of the welcome bubble's Markdown gets
   * rendered with a floated drop-cap initial (de-vincho aesthetic).
   */
  dropCap?: boolean;
  /**
   * Name shown above each bot bubble (e.g. "צוות שניר" / "לאונרדו").
   * Default: "מערכת פנימית".
   */
  botName?: string;
  /**
   * Text shown next to the three pulsing dots while waiting for the first
   * token. Default: "המערכת חושבת...".
   */
  thinkingText?: string;
};

// Keep only the display-relevant fields on a message. Holding `File` refs
// here would pin blob backing for the life of the chat (a 50-message chat
// with large PDF attachments would otherwise leak hundreds of MB).
type AttachedFileMeta = {
  name: string;
  size: number;
  type: string;
};

type Message = {
  id: number;
  sender: "bot" | "user";
  content: string;
  files?: AttachedFileMeta[];
  timestamp: string;
  streaming?: boolean;
  error?: boolean;
  excludeFromLlm?: boolean;
  llmContent?: string;
  /** When set, render a hero image inside this bubble above the Markdown body. */
  heroUrl?: string;
  /** When true, this bubble is the welcome card (used for drop-cap styling). */
  isWelcome?: boolean;
  /** When true, render the first paragraph of this bubble with a drop-cap. */
  dropCap?: boolean;
};

const NOT_CONFIGURED_CONTENT = `⚙️ **לא הוגדרו פרטי ה-LLM.**

צור קובץ \`.env.local\` עם הערכים:

\`\`\`
VITE_LLM_BASE_URL=...
VITE_LLM_API_KEY=...
VITE_LLM_MODEL=...
\`\`\`

הקובץ \`.env.example\` כולל מספר הגדרות מוכנות לשימוש (OpenAI, Groq, Ollama, LM Studio, Anthropic ונקודת קצה פנימית). לאחר מכן הפעל מחדש את \`npm run dev\`.`;

const ABORT_BEFORE_STREAM =
  "_עצרת את התשובה לפני שהתחילה. אפשר לשאול שוב בכל רגע._";
const ABORT_MID_STREAM = "_— עצרת את התשובה. אפשר לשאול שוב._";
const EMPTY_RESPONSE =
  "_השרת החזיר תשובה ריקה. נסה לנסח את השאלה מחדש או לשלוח אותה שוב._";

const now = () =>
  new Date().toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
  });

const TEXT_FILE_RE =
  /\.(txt|md|markdown|json|jsonl|csv|tsv|log|ya?ml|toml|ini|conf|env|sh|bash|zsh|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|js|mjs|cjs|ts|tsx|jsx|html|htm|css|scss|less|xml|svg)$/i;

// Keep prompts bounded: a runaway log file shouldn't silently consume the
// entire token budget (or lock up the browser). Anything larger is attached
// by name only.
const MAX_TEXT_FILE_BYTES = 500 * 1024;

async function buildUserContent(text: string, files: File[]): Promise<string> {
  if (!files || files.length === 0) return text;
  const parts: string[] = [];
  if (text.trim()) parts.push(text);
  for (const f of files) {
    const isText = /^text\//.test(f.type) || TEXT_FILE_RE.test(f.name);
    if (!isText) {
      parts.push(
        `📎 \`${f.name}\` (${f.type || "סוג לא ידוע"}) — תוכן הקובץ לא נקרא`,
      );
      continue;
    }
    if (f.size > MAX_TEXT_FILE_BYTES) {
      const kb = Math.round(f.size / 1024);
      parts.push(
        `📎 \`${f.name}\` (${kb} KB) — גדול מדי; תוכנו לא צורף.`,
      );
      continue;
    }
    try {
      const content = await f.text();
      const lang = (f.name.split(".").pop() ?? "").toLowerCase();
      // Use a fence long enough to outrun any backtick run in the content,
      // otherwise a file that itself contains ``` would close the fence early
      // and leak its tail into the prompt (and break the local markdown render).
      const fence = longestBacktickFence(content);
      parts.push(`📎 \`${f.name}\`:\n\n${fence}${lang}\n${content}\n${fence}`);
    } catch {
      parts.push(`📎 \`${f.name}\` (שגיאה בקריאת הקובץ)`);
    }
  }
  return parts.join("\n\n");
}

function longestBacktickFence(content: string): string {
  let longest = 0;
  const re = /`+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[0].length > longest) longest = m[0].length;
  }
  return "`".repeat(Math.max(3, longest + 1));
}

// Monotonically increasing ID generator — avoids Date.now() collisions when
// multiple messages are created inside the same millisecond.
let nextMessageId = 2;
const mkId = () => ++nextMessageId;

// Tracks the user's motion preference. Animations and the quill cadence
// downgrade to instant when this returns true.
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

export default function ChatBot({
  headline,
  logoUrl,
  welcomeHeroUrl,
  cadence = "frame",
  systemPrompt,
  welcome,
  suggestions,
  dropCap = false,
  botName = "מערכת פנימית",
  thinkingText = "המערכת חושבת...",
}: ChatBotProps) {
  const client = useMemo(
    () => createDefaultClient(systemPrompt),
    [systemPrompt],
  );

  const reducedMotion = usePrefersReducedMotion();
  const effectiveCadence = reducedMotion ? "frame" : cadence;

  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: 1,
      sender: "bot",
      content: client ? welcome : NOT_CONFIGURED_CONTENT,
      timestamp: now(),
      excludeFromLlm: true,
      isWelcome: true,
      // Show the hero only on the configured-and-ready welcome — when
      // configuration is missing we surface the config-hint message instead.
      heroUrl: client ? welcomeHeroUrl : undefined,
      dropCap: client ? dropCap : false,
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const spotlightRef = useRef<HTMLDivElement | null>(null);
  const dragCounter = useRef(0);
  const isAtBottomRef = useRef(true);

  const abortRef = useRef<AbortController | null>(null);
  const streamingIdRef = useRef<number | null>(null);
  const bufferRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const lastMouseRaf = useRef<number | null>(null);
  const abortedRef = useRef(false);
  // Quill cadence: timestamp of the next allowed commit. The drain loop is
  // a single rAF tick that re-arms itself; advancing this ref pauses the
  // drain without burning frames in a busy loop.
  const quillNextCommitAtRef = useRef(0);
  // Tracks whether the drain loop has commit anything yet — used to gate
  // the descend-from-above signature animation to fire exactly once.
  const quillFirstCommitRef = useRef(true);

  // Mouse-reactive spotlight: write to a CSS variable directly so we don't
  // re-render the React tree on every frame. Reads `--mouse-x` / `--mouse-y`
  // from the target element's style.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (lastMouseRaf.current !== null) return;
      lastMouseRaf.current = requestAnimationFrame(() => {
        lastMouseRaf.current = null;
        const el = spotlightRef.current;
        if (!el) return;
        el.style.background = `radial-gradient(800px circle at ${e.clientX}px ${e.clientY}px, rgba(255, 255, 255, 0.4), transparent 50%)`;
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (lastMouseRaf.current !== null) {
        cancelAnimationFrame(lastMouseRaf.current);
        lastMouseRaf.current = null;
      }
    };
  }, []);

  const handleScroll = useCallback(() => {
    const c = chatContainerRef.current;
    if (!c) return;
    const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 80;
    if (atBottom !== isAtBottomRef.current) {
      isAtBottomRef.current = atBottom;
      setShowScrollButton(!atBottom);
    }
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    const c = chatContainerRef.current;
    if (!c) return;
    if (force || isAtBottomRef.current) {
      c.scrollTop = c.scrollHeight;
      isAtBottomRef.current = true;
      setShowScrollButton(false);
    }
  }, []);

  const scrollToBottomSmooth = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Auto-scroll-to-bottom on every state change *except* the initial render
  // where only the welcome bubble exists. With a welcome hero image present
  // the welcome bubble can exceed viewport height, and pinning the welcome
  // to the bottom of the scroll container would hide the hero — the worst
  // possible first impression. Counting messages is robust against
  // StrictMode double-mounts (where a one-shot ref would still fire twice).
  useEffect(() => {
    if (messages.length <= 1 && !isTyping) return;
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

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
    // Escape aborts an in-flight stream without moving focus away.
    if (e.key === "Escape" && isStreaming) {
      e.preventDefault();
      handleAbort();
      return;
    }
    // Don't send while the IME is composing (Hebrew auto-suggest on mobile,
    // CJK IME, etc.) — `isComposing` indicates the keystroke is part of a
    // composition, where Enter means "confirm candidate", not "submit".
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      // Android Chrome sometimes reports keyCode 229 for composing keys even
      // when isComposing is false; guard that too.
      e.keyCode !== 229
    ) {
      e.preventDefault();
      void handleSend();
    }
  };

  // Frame-cadence: dump the entire pending buffer into state once per rAF.
  // This is the historic behaviour and what sniro keeps using.
  const scheduleFrameFlush = () => {
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

  // Char-class-aware delay used by the quill cadence drain.
  // A simple table beats a tunable curve here — handwriting cadence is what
  // we're modelling, not natural-language token timing.
  const quillCharDelay = (ch: string, next: string | undefined): number => {
    if (ch === "\n") {
      // Paragraph break (\n\n) gets a long pause so the eye registers it.
      if (next === "\n") return 700 + Math.random() * 200;
      return 240 + Math.random() * 120;
    }
    if (".,;:!?".includes(ch)) return 120 + Math.random() * 60;
    if ("*_`#->".includes(ch)) return 60 + Math.random() * 20;
    if (ch === " ") return 18 + Math.random() * 10;
    const cc = ch.charCodeAt(0);
    // Latin upper-case feels weighted (initial caps in a sentence).
    if (cc >= 0x41 && cc <= 0x5a) return 22 + Math.random() * 12;
    // Common Latin lower-case + Hebrew aleph-tav block: fast.
    if (
      (cc >= 0x61 && cc <= 0x7a) ||
      (cc >= 0x05d0 && cc <= 0x05ea)
    ) {
      return 14 + Math.random() * 8;
    }
    return 18 + Math.random() * 10;
  };

  // Quill cadence drain: pull one char per tick when nextCommitAt allows.
  // Re-arms itself until the buffer is empty. Caller must drain the buffer
  // again in the finally block to handle the case where the stream closes
  // with characters still queued behind a long pause.
  const scheduleQuillFlush = () => {
    if (rafRef.current !== null) return;
    const tick = () => {
      rafRef.current = null;
      const id = streamingIdRef.current;
      if (id === null) return;
      const buf = bufferRef.current;
      if (buf.length === 0) return; // drained — wait for more producer input
      const t = performance.now();
      if (t < quillNextCommitAtRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const ch = buf[0];
      bufferRef.current = buf.slice(1);
      quillNextCommitAtRef.current = t + quillCharDelay(ch, buf[1]);
      // First char of the response triggers the descend-from-above signature
      // by flipping a one-shot flag. We rely on CSS animation iteration count
      // to play it once on first visibility.
      const isFirst = quillFirstCommitRef.current;
      if (isFirst) quillFirstCommitRef.current = false;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, content: m.content + ch } : m,
        ),
      );
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const scheduleFlush = () =>
    effectiveCadence === "quill" ? scheduleQuillFlush() : scheduleFrameFlush();

  const cancelFlush = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    bufferRef.current = "";
    quillNextCommitAtRef.current = 0;
  };

  const ensureStreamingBubble = (): number => {
    if (streamingIdRef.current !== null) return streamingIdRef.current;
    const id = mkId();
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
    abortedRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
  };

  // Clean up any in-flight stream / animation frame on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const toLlmMessages = (list: Message[]): ChatMessage[] => {
    const out: ChatMessage[] = [];
    for (const m of list) {
      if (m.excludeFromLlm) continue;
      if (m.error) continue;
      // Prefer llmContent (carries attached file text) over the raw content.
      // This matters for files-only user messages where `content` is "".
      const body = m.llmContent ?? m.content;
      if (!body || !body.trim()) continue;
      out.push({
        role: m.sender === "user" ? "user" : "assistant",
        content: body,
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
    abortedRef.current = false;
    quillNextCommitAtRef.current = 0;
    quillFirstCommitRef.current = true;
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
        // Either the server returned nothing, or the user stopped before
        // anything arrived. Surface the appropriate marker.
        const content = abortedRef.current ? ABORT_BEFORE_STREAM : EMPTY_RESPONSE;
        setMessages((prev) => [
          ...prev,
          {
            id: mkId(),
            sender: "bot",
            content,
            timestamp: now(),
            excludeFromLlm: true,
          },
        ]);
      } else {
        // Drain any buffered delta exactly once. cancelFlush drops the rAF so
        // a late flush can't re-append pending after we finalize here.
        const pending = bufferRef.current;
        cancelFlush();
        const id = streamingIdRef.current;
        const stoppedByUser = abortedRef.current;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== id) return m;
            const nextContent = pending ? m.content + pending : m.content;
            return {
              ...m,
              content: stoppedByUser
                ? `${nextContent}\n\n${ABORT_MID_STREAM}`
                : nextContent,
              streaming: false,
            };
          }),
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
                  content: m.content || ABORT_BEFORE_STREAM,
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

  const sendingRef = useRef(false);
  const handleSend = async (overrideText?: string) => {
    // `isStreaming` only flips true after the request is in flight, but the
    // file-reading step before that is async — guard the whole window so a
    // second click (chip, Enter) during file reads doesn't double-submit.
    if (sendingRef.current || isStreaming) return;
    if (!client) return;
    const query = typeof overrideText === "string" ? overrideText : inputValue;
    const hasFiles = attachedFiles.length > 0;
    if (!query.trim() && !hasFiles) return;

    sendingRef.current = true;
    try {
      const currentFiles = [...attachedFiles];
      const filesMeta: AttachedFileMeta[] = currentFiles.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
      }));
      const userMsg: Message = {
        id: mkId(),
        sender: "user",
        content: query,
        files: filesMeta,
        timestamp: now(),
      };

      // Show user message instantly.
      const visibleHistory = [...messages, userMsg];
      setMessages(visibleHistory);
      setInputValue("");
      setAttachedFiles([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setTimeout(() => scrollToBottom(true), 50);

      // Build LLM content (reads attached text files); may take a tick. The
      // File refs live only in this function scope and are released as soon
      // as buildUserContent returns — the message itself holds only metadata.
      const llmContent = await buildUserContent(query, currentFiles);
      setMessages((prev) =>
        prev.map((m) => (m.id === userMsg.id ? { ...m, llmContent } : m)),
      );
      const historyForLlm = visibleHistory.map((m) =>
        m.id === userMsg.id ? { ...m, llmContent } : m,
      );

      await runStream(historyForLlm);
    } finally {
      sendingRef.current = false;
    }
  };

  // Stable identity so the memoized MessageItem doesn't re-render every tick.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const handleRetryFrom = useCallback((errorId: number) => {
    // sendingRef is true for the full duration of handleSend + runStream, so
    // this also blocks retry while a normal send is in flight.
    if (sendingRef.current) return;
    const current = messagesRef.current;
    const idx = current.findIndex((m) => m.id === errorId);
    if (idx < 0) return;
    let userIdx = idx - 1;
    while (userIdx >= 0 && current[userIdx].sender !== "user") userIdx--;
    if (userIdx < 0) return;
    const historyForRetry = current.slice(0, userIdx + 1);
    const kept = current.filter((m) => m.id !== errorId);
    sendingRef.current = true;
    setMessages(kept);
    setTimeout(() => {
      void runStream(historyForRetry).finally(() => {
        sendingRef.current = false;
      });
    }, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showConfigHintInHeader = !client;

  return (
    <div
      dir="rtl"
      data-cadence={effectiveCadence}
      className="min-h-dvh relative overflow-hidden font-heebo"
      style={{ backgroundColor: "var(--bg)", color: "var(--ink)" }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
        ::selection { background: rgba(var(--accent-rgb), 0.15); color: var(--ink); text-shadow: none; }
        .font-heebo { font-family: var(--font-body); letter-spacing: var(--display-tracking); }

        .hw-accelerate {
          will-change: transform, opacity, filter;
          backface-visibility: hidden;
          transform: translateZ(0);
        }

        .premium-prose { max-width: 65ch; color: var(--ink); }
        .premium-prose:hover p, .premium-prose:hover ul, .premium-prose:hover ol, .premium-prose:hover blockquote { color: var(--muted); text-shadow: none; transition: color 0.4s var(--ease-fluid); }
        .premium-prose p:hover, .premium-prose ul:hover, .premium-prose ol:hover, .premium-prose blockquote:hover { color: var(--ink); text-shadow: 0px 4px 12px rgba(var(--ink-rgb), 0.05), 0px 1px 0px rgba(255, 255, 255, 0.85); transition: color 0.15s var(--ease-fluid); }
        .premium-prose p { margin-bottom: 1.35em; line-height: 1.7; font-size: 15.5px; transition: color 0.4s var(--ease-fluid); }
        .premium-prose p:last-child { margin-bottom: 0; }

        .premium-prose strong {
          font-weight: 600; color: inherit;
          background: linear-gradient(120deg, rgba(var(--accent-rgb), 0.08) 0%, rgba(var(--accent-rgb), 0.02) 100%);
          padding: 0.1em 0.35em; border-radius: 6px;
          box-shadow: inset 0 -1px 0 rgba(var(--accent-rgb), 0.15), 0 2px 4px rgba(var(--accent-rgb), 0.03);
          letter-spacing: -0.01em; margin: 0 0.1em; transition: color 0.4s var(--ease-fluid);
        }
        .premium-prose p:hover strong, .premium-prose ul:hover strong, .premium-prose ol:hover strong { color: var(--ink); }

        .premium-prose code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.85em; color: var(--accent); background: rgba(var(--accent-rgb), 0.06);
          border: 1px solid rgba(var(--accent-rgb), 0.12); padding: 0.2em 0.4em; border-radius: 6px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.8); margin: 0 0.1em; letter-spacing: 0;
        }
        .premium-prose pre code {
          color: inherit; background: transparent; border: 0; padding: 0; border-radius: 0;
          box-shadow: none; font-size: 13px; margin: 0;
        }

        .premium-prose blockquote {
          margin: 1.8em 0; padding: 0.8em 1.2em 0.8em 0;
          border-right: 3px solid rgba(var(--accent-rgb), 0.4);
          background: linear-gradient(90deg, transparent, rgba(var(--accent-rgb), 0.03)); border-radius: 4px;
          font-style: italic; font-size: 16px; line-height: 1.6; color: inherit; transition: all 0.4s var(--ease-fluid);
        }
        .premium-prose blockquote:hover { border-right-color: var(--accent); background: linear-gradient(90deg, transparent, rgba(var(--accent-rgb), 0.06)); }

        .premium-prose ul { margin-top: 1.5em; margin-bottom: 1.5em; padding-right: 1.5em; list-style: none; transition: color 0.4s var(--ease-fluid); }
        .premium-prose li { position: relative; margin-bottom: 1em; line-height: 1.65; font-size: 15.5px; }
        .premium-prose li:last-child { margin-bottom: 0; }
        .premium-prose ul li::before {
          content: ""; position: absolute; right: -1.4em; top: 0.65em; width: 6px; height: 6px;
          border-radius: 50%; background: var(--accent);
          box-shadow: 0 0 10px rgba(var(--accent-rgb), 0.6), inset 0 1px 2px rgba(255,255,255,0.8);
          transition: all 0.4s var(--ease-fluid);
        }
        .premium-prose:hover ul:not(:hover) li::before { background: var(--muted); box-shadow: none; }

        .text-ink {
          color: var(--ink);
          text-shadow: 0px 4px 12px rgba(var(--ink-rgb), 0.05), 0px 1px 0px rgba(255, 255, 255, 0.85);
          -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility;
        }

        .ink-settle { animation: inkSettle 0.5s var(--ease-fluid) forwards; opacity: 0; will-change: transform, filter, opacity, letter-spacing; }
        @keyframes inkSettle {
          0% { filter: blur(5px); opacity: 0; transform: translate3d(0, 8px, 0); color: var(--ink-soft); letter-spacing: -0.02em; }
          100% { filter: blur(0); opacity: 1; transform: translate3d(0, 0, 0); color: var(--ink); letter-spacing: var(--display-tracking); }
        }

        .specular-highlight::before {
          content: ""; position: absolute; top: 0; left: 10%; right: 10%; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,1) 50%, transparent); opacity: 0.9; pointer-events: none; z-index: 5;
        }

        .glass-panel {
          position: relative; background: var(--panel-bg);
          backdrop-filter: blur(30px) saturate(1.4); -webkit-backdrop-filter: blur(30px) saturate(1.4);
          border: 1px solid var(--panel-border);
          box-shadow: var(--panel-shadow);
          transition: transform 0.3s var(--ease-fluid), box-shadow 0.3s var(--ease-fluid), border-color 0.3s var(--ease-fluid); overflow: hidden;
        }
        .glass-panel::after {
          content: ""; position: absolute; inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
          opacity: 0.02; mix-blend-mode: overlay; pointer-events: none; z-index: 0;
        }
        .glass-panel > * { position: relative; z-index: 1; }
        .glass-panel:hover {
          box-shadow: var(--panel-shadow-hover);
          border-color: rgba(255, 255, 255, 1); transition: all 0.15s var(--ease-out-quick);
        }

        .bot-bubble {
          background: var(--bubble-bot-bg);
          box-shadow: var(--bubble-bot-shadow);
        }
        .bot-bubble.error-bubble {
          background: linear-gradient(135deg, rgba(254, 242, 242, 0.98) 0%, rgba(254, 226, 226, 0.7) 100%);
          box-shadow: 0 16px 40px -8px rgba(var(--error-rgb), 0.06), inset 0px 1px 1px rgba(255, 255, 255, 1), inset 1px 0px 20px rgba(var(--error-rgb), 0.05);
        }
        .error-bubble .premium-prose strong {
          background: linear-gradient(120deg, rgba(var(--error-rgb), 0.10) 0%, rgba(var(--error-rgb), 0.02) 100%);
          box-shadow: inset 0 -1px 0 rgba(var(--error-rgb), 0.22), 0 2px 4px rgba(var(--error-rgb), 0.04);
        }
        .error-bubble .premium-prose code {
          color: var(--error-deep); background: rgba(var(--error-rgb), 0.06);
          border-color: rgba(var(--error-rgb), 0.18);
        }
        .error-bubble .premium-prose pre {
          background: rgba(var(--error-rgb), 0.05); border-color: rgba(var(--error-rgb), 0.18);
        }

        .glass-input-focused {
          background: rgba(255, 255, 255, 1) !important;
          box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.15), 0 24px 60px rgba(var(--accent-rgb), 0.1), inset 0 1px 3px rgba(255, 255, 255, 1) !important;
          border-color: rgba(var(--accent-rgb), 0.5) !important; transform: translate3d(0, -2px, 0); transition: all 0.4s var(--ease-fluid);
        }

        .glass-chip {
          position: relative; background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(255, 255, 255, 0.7);
          box-shadow: 0 4px 15px rgba(var(--ink-rgb), 0.02), inset 0 1px 1px rgba(255,255,255,0.9);
          transition: all 0.3s var(--ease-fluid); overflow: hidden; cursor: pointer;
          color: var(--ink-soft);
        }
        .glass-chip:hover {
          background: rgba(255, 255, 255, 0.98); transform: translate3d(0, -3px, 0) scale3d(1.02, 1.02, 1);
          box-shadow: 0 12px 30px rgba(var(--accent-rgb), 0.08), 0 0 0 1px rgba(var(--accent-rgb), 0.2), inset 0 1px 2px rgba(255,255,255,1);
          transition: all 0.15s var(--ease-out-quick);
        }
        .glass-chip:active {
          transform: translate3d(0, -1px, 0) scale3d(0.96, 0.96, 1);
          box-shadow: 0 4px 15px rgba(var(--accent-rgb), 0.05), inset 0 1px 1px rgba(255,255,255,0.9);
          transition: all 0.1s ease-out;
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
        .icon-glow { filter: drop-shadow(0px 4px 8px rgba(var(--accent-rgb), 0.4)); }
        .icon-glow-strong { filter: drop-shadow(0px 0px 12px rgba(var(--accent-rgb), 0.6)); }

        .text-etched { text-shadow: 0px 1px 0px rgba(255, 255, 255, 0.9); }

        .chat-scroll-mask {
          mask-image: linear-gradient(to bottom, transparent 0%, black 2%, black 100%);
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 2%, black 100%);
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
          margin-right: 3px; background: var(--caret-color); border-radius: 1px;
          box-shadow: var(--caret-glow);
          animation: caretBlink 1s steps(2) infinite;
          position: relative;
        }
        .stream-caret::after {
          content: var(--caret-content);
          position: absolute;
          top: 50%; right: 0;
          transform: translate(50%, -50%) rotate(-25deg);
          font-size: 0;
          line-height: 0;
        }

        .send-btn-active {
          background: var(--send-btn-bg);
          box-shadow: var(--send-btn-shadow-active);
          transition: all 0.3s var(--ease-fluid);
        }
        .send-btn-active:active {
          transform: scale3d(0.9, 0.9, 1); box-shadow: 0 4px 15px -2px rgba(var(--accent-rgb), 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.2); transition: all 0.1s ease-out;
        }

        .stop-btn {
          background: linear-gradient(135deg, var(--error) 0%, var(--error-strong) 100%);
          color: white;
          box-shadow: 0 10px 30px -5px rgba(var(--error-rgb), 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.4);
          transition: all 0.2s var(--ease-fluid);
        }
        .stop-btn:hover { transform: scale3d(1.05, 1.05, 1); }
        .stop-btn:active { transform: scale3d(0.92, 0.92, 1); }

        .drag-overlay { backdrop-filter: blur(12px); transition: all 0.4s var(--ease-fluid); }

        .glass-input textarea::-webkit-scrollbar { width: 4px; }
        .glass-input textarea::-webkit-scrollbar-track { background: transparent; }
        .glass-input textarea::-webkit-scrollbar-thumb { background: rgba(var(--accent-rgb), 0.2); border-radius: 4px; }
        .glass-input textarea::-webkit-scrollbar-thumb:hover { background: rgba(var(--accent-rgb), 0.4); }

        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(var(--muted-rgb), 0.2); border-radius: 10px; border: 2px solid var(--bg); }
        ::-webkit-scrollbar-thumb:hover { background: rgba(var(--muted-rgb), 0.4); }

        /* Welcome hero — every persona gets a fully-themed frame via tokens.
           --welcome-hero-shape:    border-radius (default rounded rect)
           --welcome-hero-aspect:   aspect-ratio (default auto)
           --welcome-hero-fit:      object-fit (default contain)
           --welcome-hero-position: object-position (default center)
           --welcome-hero-frame:    box-shadow stack
           --welcome-hero-bg:       backdrop tint behind image
           --welcome-hero-width:    max-width
        */
        .welcome-hero {
          display: block;
          width: 100%;
          max-width: var(--welcome-hero-width, 280px);
          aspect-ratio: var(--welcome-hero-aspect, auto);
          height: auto;
          object-fit: var(--welcome-hero-fit, contain);
          object-position: var(--welcome-hero-position, center);
          margin: 0 auto 1.25rem;
          border-radius: var(--welcome-hero-shape, 16px);
          box-shadow: var(--welcome-hero-frame);
          background: var(--welcome-hero-bg, rgba(255, 255, 255, 0.6));
        }
        @media (max-width: 480px) {
          .welcome-hero { max-width: 200px; margin-bottom: 0.75rem; }
        }

        /* Drop cap — only active when --welcome-dropcap is set to "1". */
        .welcome-bubble[data-dropcap="1"] .premium-prose > p:first-of-type::first-letter {
          float: right;
          font-family: var(--font-display);
          font-style: var(--display-style);
          font-weight: 600;
          font-size: 3.6em;
          line-height: 0.9;
          padding: 0.05em 0 0.05em 0.18em;
          margin-inline-start: 0.18em;
          color: var(--accent);
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.4);
        }
        @media (max-width: 480px) {
          .welcome-bubble[data-dropcap="1"] .premium-prose > p:first-of-type::first-letter {
            font-size: 2.6em;
          }
        }

        /* Manuscript margin rule (de-vincho only). Logical property so it
           naturally renders on the leading edge in RTL. */
        .chat-shell {
          position: relative;
        }
        .chat-shell::before {
          content: "";
          position: absolute;
          top: 8%;
          bottom: 8%;
          inset-inline-end: -8px;
          width: 1px;
          background: var(--pattern-margin-rule);
          pointer-events: none;
        }
        @media (max-width: 480px) {
          .chat-shell::before { display: none; }
        }

        .paperclip-btn:hover { background: rgba(var(--accent-rgb), 0.1); color: var(--accent); }
        .chat-textarea::placeholder { color: var(--muted); }

        /* Bot avatar (small circle next to bubble) — adopts persona accent. */
        .bot-avatar {
          background: rgba(255, 255, 255, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.8);
          color: var(--accent);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          box-shadow: 0 4px 8px rgba(var(--ink-rgb), 0.06);
        }

        /* User bubble — token-driven so each persona owns its emphasis colour. */
        .user-bubble {
          background: var(--bubble-user-bg);
          border: 1px solid var(--bubble-user-border);
          box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.7),
            0 8px 20px -5px rgba(var(--accent-rgb), 0.05);
        }

        /* Bot-bubble accent rail — runs down the leading edge of the bubble. */
        .bubble-rail {
          background: linear-gradient(to bottom, rgba(var(--accent-rgb), 0.6), rgba(var(--accent-rgb), 0.1));
          box-shadow: 0 0 8px rgba(var(--accent-rgb), 0.3);
        }
        .error-bubble + .bubble-rail,
        .bubble-rail.error {
          background: linear-gradient(to bottom, rgba(var(--error-rgb), 0.6), rgba(var(--error-rgb), 0.1));
          box-shadow: 0 0 8px rgba(var(--error-rgb), 0.3);
        }
      `,
        }}
      />

      <div className="absolute inset-0 overflow-hidden pointer-events-none mix-blend-multiply opacity-80">
        <div
          className="aurora-blob hw-accelerate w-[900px] h-[600px] top-[-15%] right-[-20%]"
          style={{ animationDuration: "30s", background: "var(--aurora-1)" }}
        />
        <div
          className="aurora-blob hw-accelerate w-[1000px] h-[700px] bottom-[-20%] left-[-20%]"
          style={{
            animationDuration: "35s",
            animationDelay: "-10s",
            background: "var(--aurora-2)",
          }}
        />
        <div
          className="aurora-blob hw-accelerate w-[600px] h-[500px] top-[30%] left-[20%]"
          style={{
            animationDuration: "20s",
            filter: "blur(100px)",
            background: "var(--aurora-3)",
          }}
        />
      </div>

      <div
        ref={spotlightRef}
        className="absolute inset-0 pointer-events-none transition-opacity duration-1000 mix-blend-overlay z-0 hw-accelerate"
      />

      <div
        className="absolute top-0 left-0 w-full h-[30vh] z-10 pointer-events-none opacity-90 hw-accelerate"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, var(--bg), transparent)",
        }}
      />

      <div
        className="chat-shell relative z-20 max-w-4xl mx-auto h-dvh flex flex-col px-4 py-8"
        style={{ backgroundImage: "var(--pattern-bg)" }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <header
          className="flex items-center justify-between mb-8 px-2 bot-message-enter hw-accelerate shrink-0"
          data-streaming={isStreaming ? "true" : "false"}
        >
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <div
                data-logo="custom"
                className="w-10 h-10 rounded-full glass-panel flex items-center justify-center overflow-hidden relative"
                style={{ color: "var(--accent)" }}
              >
                <img
                  src={logoUrl}
                  alt=""
                  className="w-full h-full object-contain p-1"
                />
                <div
                  className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full border-2"
                  style={{
                    backgroundColor: "var(--accent)",
                    borderColor: "var(--bg-elev, #fff)",
                    boxShadow: "0 0 8px rgba(var(--accent-rgb), 0.4)",
                  }}
                />
              </div>
            ) : (
              <div
                className="w-10 h-10 rounded-full glass-panel flex items-center justify-center relative"
                style={{ color: "var(--accent)" }}
              >
                <Sparkles
                  className="w-5 h-5 icon-glow"
                  style={{ color: "var(--accent)" }}
                />
                <div
                  className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full border-2"
                  style={{
                    backgroundColor: "var(--accent)",
                    borderColor: "var(--bg-elev, #fff)",
                    boxShadow: "0 0 8px rgba(var(--accent-rgb), 0.4)",
                  }}
                />
              </div>
            )}
            <div>
              <h1
                className="font-semibold text-[17px] leading-tight"
                style={{
                  color: "var(--ink)",
                  fontFamily: "var(--font-display)",
                  fontStyle: "var(--display-style)",
                  fontWeight: "var(--display-weight)" as unknown as number,
                  letterSpacing: "var(--display-tracking)",
                }}
              >
                {headline}
              </h1>
              <p
                className="text-[13px] font-medium text-etched"
                style={{ color: "var(--muted)" }}
              >
                {isStreaming
                  ? "מזרים תשובה…"
                  : showConfigHintInHeader
                    ? "ממתין להגדרת LLM"
                    : "מחובר ומוכן"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <div
              className="px-3 py-1.5 rounded-full glass-panel text-xs font-semibold flex items-center gap-1.5 shadow-sm"
              style={{ color: "var(--ink-soft)" }}
            >
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
          role="log"
          aria-live="polite"
          aria-busy={isStreaming}
          className={`flex-1 overflow-y-auto mb-6 px-2 pt-2 pb-4 relative z-10 space-y-7 chat-scroll-mask transition-opacity duration-500 ease-in-out hw-accelerate ${isInputFocused ? "opacity-80" : "opacity-100"}`}
        >
          {messages.map((msg, i) => (
            <MessageItem
              key={msg.id}
              msg={msg}
              isLatest={i === messages.length - 1}
              onRetry={handleRetryFrom}
              botName={botName}
              botAvatarUrl={logoUrl}
            />
          ))}

          {isTyping && (
            <div className="flex gap-4 max-w-[85%] bot-message-enter justify-start hw-accelerate">
              <BotAvatar logoUrl={logoUrl} />
              <div className="glass-panel bot-bubble rounded-2xl rounded-tr-sm px-5 py-4 flex items-center gap-2 hw-accelerate">
                {[0, 150, 300].map((delay) => (
                  <div
                    key={delay}
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: "var(--accent)",
                      boxShadow: "0 0 8px rgba(var(--accent-rgb), 0.6)",
                      animation: "organicPulse 1s ease-in-out infinite",
                      animationDelay: `${delay}ms`,
                    }}
                  />
                ))}
                <span
                  className="text-[13px] font-semibold mr-3 text-etched"
                  style={{ color: "var(--accent)" }}
                >
                  {thinkingText}
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
            <ArrowDown
              className="w-5 h-5 icon-glow"
              style={{ color: "var(--accent)" }}
            />
          </button>
        )}

        {isDragging && (
          <div
            className="absolute inset-0 z-50 drag-overlay flex items-center justify-center bg-white/30 rounded-3xl m-4 border-[3px] border-dashed hw-accelerate"
            style={{
              borderColor: "rgba(var(--accent-rgb), 0.4)",
              boxShadow: "inset 0 0 100px rgba(var(--accent-rgb), 0.1)",
            }}
          >
            <div
              className="glass-panel p-12 rounded-[2rem] flex flex-col items-center gap-5 transform scale-105 border border-white hw-accelerate"
              style={{
                animation: "slideUpFade 0.3s ease-out",
                boxShadow:
                  "0 30px 60px -15px rgba(var(--accent-rgb), 0.2)",
              }}
            >
              <div
                className="w-24 h-24 rounded-full flex items-center justify-center border border-white/50"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(var(--accent-rgb), 0.1), rgba(var(--accent-soft-rgb), 0.05))",
                  boxShadow: "0 0 30px rgba(var(--accent-rgb), 0.2)",
                }}
              >
                <UploadCloud
                  className="w-12 h-12 icon-glow-strong"
                  style={{ color: "var(--accent)" }}
                />
              </div>
              <h2
                className="text-[20px] font-semibold mt-2 tracking-tight"
                style={{
                  color: "var(--ink)",
                  fontFamily: "var(--font-display)",
                }}
              >
                שחרר קבצים כאן
              </h2>
              <p
                className="text-[14px] font-medium text-center leading-snug"
                style={{ color: "var(--ink-soft)" }}
              >
                המסמכים יצורפו להודעה הבאה שלך
                <br />
                וייקראו על ידי המודל.
              </p>
            </div>
          </div>
        )}

        <div className="relative z-20 pt-2 pb-6 px-2 hw-accelerate shrink-0">
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {suggestions.map((chip, idx) => (
                <button
                  key={idx}
                  onClick={() => void handleSend(chip.prompt)}
                  disabled={isStreaming || !client}
                  className="glass-chip px-4 py-2 rounded-full text-[13px] font-medium flex items-center gap-2 tracking-tight hw-accelerate disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ color: "var(--ink-soft)" }}
                >
                  <MessageCircle
                    className="w-3.5 h-3.5 icon-glow"
                    style={{ color: "var(--accent)", opacity: 0.8 }}
                  />
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3 px-2 bot-message-enter hw-accelerate">
              {attachedFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="glass-panel pl-2 pr-3 py-1.5 rounded-full flex items-center gap-2 bg-white/80"
                  style={{
                    borderColor: "rgba(var(--accent-rgb), 0.2)",
                    boxShadow: "0 4px 10px rgba(var(--accent-rgb), 0.05)",
                  }}
                >
                  <FileText
                    className="w-3.5 h-3.5 icon-glow"
                    style={{ color: "var(--accent)" }}
                  />
                  <span
                    className="text-[13px] font-medium max-w-[120px] truncate"
                    dir="ltr"
                    style={{ color: "var(--ink)" }}
                  >
                    {file.name}
                  </span>
                  <button
                    onClick={() => removeFile(idx)}
                    className="w-5 h-5 rounded-full hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors"
                    style={{ color: "var(--muted)" }}
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
              className="paperclip-btn w-11 h-11 mb-0.5 rounded-full flex items-center justify-center bg-transparent transition-colors shrink-0 relative overflow-hidden group active:scale-90 cursor-pointer"
              style={{ color: "var(--muted)" }}
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
              className="flex-1 bg-transparent border-none outline-none text-[15px] font-medium px-2 py-3.5 leading-relaxed resize-none overflow-y-auto chat-textarea"
              rows={1}
              style={{
                maxHeight: "150px",
                color: "var(--ink)",
              }}
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
                    ? "send-btn-active text-white"
                    : "cursor-not-allowed"
                }`}
                style={
                  client && (inputValue.trim() || attachedFiles.length > 0)
                    ? undefined
                    : {
                        backgroundColor: "rgba(var(--ink-rgb), 0.05)",
                        color: "var(--muted)",
                      }
                }
                aria-label="שלח הודעה"
              >
                <Send
                  className="w-5 h-5 -ml-1"
                  style={{ transform: "scaleX(-1)" }}
                />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type MessageItemProps = {
  msg: Message;
  isLatest: boolean;
  onRetry: (id: number) => void;
  botName: string;
  botAvatarUrl?: string;
};

// Shared bubble-side avatar — renders the persona logo when one is supplied,
// falling back to the lucide Sparkles icon. Kept outside MessageItem so the
// typing-indicator can reuse it without duplicating the styling.
function BotAvatar({ logoUrl }: { logoUrl?: string }) {
  return (
    <div className="bot-avatar w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 overflow-hidden">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          className="w-full h-full object-contain p-0.5"
          style={{ color: "var(--accent)" }}
        />
      ) : (
        <Sparkles
          className="w-4 h-4 icon-glow"
          style={{ color: "var(--accent)" }}
        />
      )}
    </div>
  );
}

const MessageItem = memo(function MessageItem({
  msg,
  isLatest,
  onRetry,
  botName,
  botAvatarUrl,
}: MessageItemProps) {
  if (msg.sender === "bot") {
    return (
      <div className="flex w-full hw-accelerate justify-start bot-message-enter">
        <div className="flex gap-4 max-w-[85%]">
          <BotAvatar logoUrl={botAvatarUrl} />
          <div className="space-y-3 w-full">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[12px] font-semibold text-etched"
                style={{ color: "var(--ink-soft)" }}
              >
                {msg.error ? "הודעת מערכת" : botName}
              </span>
              <span
                className="text-[10px] text-etched font-medium"
                style={{ color: "var(--muted)" }}
              >
                {msg.timestamp}
              </span>
            </div>

            <div
              className={`glass-panel bot-bubble specular-highlight hw-accelerate rounded-[24px] rounded-tr-[8px] px-7 py-6 inline-block relative group max-w-[95%] ${msg.error ? "error-bubble" : ""} ${msg.isWelcome ? "welcome-bubble" : ""}`}
              style={{
                boxShadow:
                  "0 20px 40px -12px rgba(var(--ink-rgb), 0.06), 0 0 0 1px rgba(var(--accent-rgb), 0.04)",
              }}
              data-dropcap={msg.dropCap ? "1" : undefined}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-white/60 to-transparent pointer-events-none rounded-[24px] rounded-tr-[8px]" />
              <div
                className={`absolute right-0 top-6 bottom-6 w-[3px] rounded-l-full opacity-60 group-hover:opacity-100 transition-opacity duration-500 bubble-rail ${msg.error ? "error" : ""}`}
              />
              <div className="relative z-10 pr-2">
                {msg.heroUrl && (
                  <img
                    src={msg.heroUrl}
                    alt=""
                    className="welcome-hero"
                    loading="eager"
                  />
                )}
                <Markdown>{msg.content || " "}</Markdown>
                {msg.streaming && <span className="stream-caret" />}
              </div>
            </div>

            {msg.error && isLatest && (
              <button
                onClick={() => onRetry(msg.id)}
                className="glass-chip px-4 py-2 rounded-full text-[13px] font-medium inline-flex items-center gap-2 hw-accelerate"
                style={{ color: "var(--ink-soft)" }}
                aria-label="נסה שוב"
              >
                <RotateCcw
                  className="w-3.5 h-3.5"
                  style={{ color: "var(--accent)" }}
                />
                נסה שוב
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full hw-accelerate justify-end user-message-enter">
      <div className="max-w-[75%] flex flex-col items-end">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[10px] text-etched font-medium"
            style={{ color: "var(--muted)" }}
          >
            {msg.timestamp}
          </span>
          <span
            className="text-[12px] font-semibold text-etched"
            style={{ color: "var(--ink-soft)" }}
          >
            את/ה
          </span>
        </div>
        <div className="flex flex-col items-end gap-2 w-full">
          {msg.files && msg.files.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-end w-full">
              {msg.files.map((file, i) => (
                <div
                  key={i}
                  className="glass-panel px-3 py-2 rounded-xl flex items-center gap-2 bg-white/60 backdrop-blur-xl hw-accelerate"
                  style={{ color: "var(--ink)" }}
                >
                  <FileText
                    className="w-4 h-4"
                    style={{ color: "var(--accent)" }}
                  />
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
            <div className="user-bubble rounded-[22px] rounded-tl-[6px] px-6 py-5 inline-block backdrop-blur-xl relative overflow-hidden specular-highlight hw-accelerate">
              <p className="text-ink text-[15.5px] leading-[1.65] font-medium relative z-10 whitespace-pre-wrap">
                {msg.content}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

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
