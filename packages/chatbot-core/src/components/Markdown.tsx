import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  children: string;
  className?: string;
  /**
   * When true, throttle the markdown re-parse to PARSE_INTERVAL_MS while
   * still flushing on syntactic boundaries. Without this, every streaming
   * token rebuilds the full markdown AST — O(n²) over the response. The
   * caller flips this to false at stream end so the final tree always
   * reflects the complete content.
   */
  streaming?: boolean;
};

const PARSE_INTERVAL_MS = 160;
// Flush boundaries: end-of-sentence, end-of-line, and code-fence delimiters.
// Code fences must flush immediately so a pending fence can't get styled
// as inline code mid-stream.
const TERMINATOR_RE = /[.!?\n)\]]$/;
const CODE_FENCE = "```";

function MarkdownInner({ children, className, streaming }: Props) {
  const [displayed, setDisplayed] = useState<string>(children);
  const lastParseAtRef = useRef<number>(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!streaming) {
      if (displayed !== children) {
        setDisplayed(children);
        lastParseAtRef.current = performance.now();
      }
      return;
    }
    if (displayed === children) return;

    const now = performance.now();
    const elapsed = now - lastParseAtRef.current;
    const tail = children.slice(displayed.length);
    const shouldFlush =
      displayed === "" ||
      elapsed >= PARSE_INTERVAL_MS ||
      TERMINATOR_RE.test(children.slice(-1)) ||
      tail.includes(CODE_FENCE);

    if (shouldFlush) {
      setDisplayed(children);
      lastParseAtRef.current = now;
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      return;
    }

    if (flushTimerRef.current !== null) return;
    const wait = Math.max(0, PARSE_INTERVAL_MS - elapsed);
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      setDisplayed(children);
      lastParseAtRef.current = performance.now();
    }, wait);

    return () => {
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [children, streaming, displayed]);

  return (
    <div className={`premium-prose text-ink ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children, ...rest }: any) {
            return (
              <pre
                dir="ltr"
                {...rest}
                className="my-4 rounded-xl p-4 overflow-x-auto shadow-inner text-left leading-[1.45]"
                style={{
                  background: "rgba(var(--ink-rgb), 0.04)",
                  border: "1px solid rgba(var(--accent-rgb), 0.15)",
                }}
              >
                {children}
              </pre>
            );
          },
          a({ children, ...props }: any) {
            return (
              <a
                {...props}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 transition-colors"
                style={{
                  color: "var(--accent-rare, var(--accent))",
                  textDecorationColor: "rgba(var(--accent-rgb), 0.3)",
                }}
              >
                {children}
              </a>
            );
          },
          h1({ children }: any) {
            return (
              <h1
                className="font-semibold text-[24px] mt-6 mb-3 tracking-tight"
                style={{
                  color: "var(--ink)",
                  fontFamily: "var(--font-display)",
                  fontStyle: "var(--display-style)",
                }}
              >
                {children}
              </h1>
            );
          },
          h2({ children }: any) {
            return (
              <h2
                className="font-semibold text-[20px] mt-5 mb-2.5 tracking-tight"
                style={{
                  color: "var(--ink)",
                  fontFamily: "var(--font-display)",
                  fontStyle: "var(--display-style)",
                }}
              >
                {children}
              </h2>
            );
          },
          h3({ children }: any) {
            return (
              <h3
                className="font-semibold text-[17px] mt-4 mb-2 tracking-tight"
                style={{
                  color: "var(--ink)",
                  fontFamily: "var(--font-display)",
                  fontStyle: "var(--display-style)",
                }}
              >
                {children}
              </h3>
            );
          },
          ol({ children }: any) {
            return (
              <ol className="list-decimal pr-6 my-4 space-y-1.5 text-[15.5px] leading-[1.6]">
                {children}
              </ol>
            );
          },
          hr() {
            return (
              <hr
                className="my-6 border-0 h-px"
                style={{
                  background:
                    "linear-gradient(to right, transparent, rgba(var(--accent-rgb), 0.2), transparent)",
                }}
              />
            );
          },
        }}
      >
        {displayed}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownInner, (prev, next) => {
  return (
    prev.children === next.children &&
    prev.className === next.className &&
    prev.streaming === next.streaming
  );
});
