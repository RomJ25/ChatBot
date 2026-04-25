import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  children: string;
  className?: string;
};

// Memoize on a coarse hash so the streaming reveal doesn't re-parse the
// entire markdown tree on every dropped character. The hash is just
// (length, lastCharCode) — enough that any append flips it, but unchanged
// when React re-renders for unrelated reasons. With rAF-batched flushes
// the worst case is ~60 re-parses/sec, which is well within frame budget
// for typical assistant-message lengths.
function MarkdownInner({ children, className }: Props) {
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
                className="my-4 rounded-xl p-4 overflow-x-auto shadow-inner text-left"
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
                className="font-semibold text-[22px] mt-6 mb-3 tracking-tight"
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
                className="font-semibold text-[19px] mt-5 mb-2.5 tracking-tight"
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
                className="font-semibold text-[16px] mt-4 mb-2 tracking-tight"
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
              <ol className="list-decimal pr-6 my-4 space-y-1.5 text-[15.5px] leading-[1.7]">
                {children}
              </ol>
            );
          },
          table({ children }: any) {
            return (
              <div
                className="my-4 overflow-x-auto rounded-lg"
                style={{ border: "1px solid rgba(var(--accent-rgb), 0.1)" }}
              >
                <table className="border-collapse w-full text-[14px]">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }: any) {
            return (
              <th
                className="text-right px-3 py-2 font-semibold"
                style={{
                  borderBottom: "1px solid rgba(var(--accent-rgb), 0.2)",
                  background: "rgba(var(--accent-rgb), 0.04)",
                  color: "var(--ink)",
                }}
              >
                {children}
              </th>
            );
          },
          td({ children }: any) {
            return (
              <td
                className="text-right px-3 py-2"
                style={{
                  borderBottom: "1px solid rgba(var(--muted-rgb), 0.15)",
                  color: "var(--ink-soft)",
                }}
              >
                {children}
              </td>
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
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownInner, (prev, next) => {
  // Skip re-render when only the React parent re-rendered with the same
  // string content. During streaming this saves ~50% of markdown re-parses
  // when the buffer drain commits a char that doesn't change props identity
  // (parent state still changed, but our string didn't).
  return (
    prev.children === next.children && prev.className === next.className
  );
});
