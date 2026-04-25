import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  children: string;
  className?: string;
};

export function Markdown({ children, className }: Props) {
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
                className="my-4 rounded-xl bg-[#0f172a]/[0.04] border border-[#2563eb]/15 p-4 overflow-x-auto shadow-inner text-left"
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
                className="text-[#2563eb] underline decoration-[#2563eb]/30 underline-offset-2 hover:decoration-[#2563eb] transition-colors"
              >
                {children}
              </a>
            );
          },
          h1({ children }: any) {
            return (
              <h1 className="text-[#0f172a] font-semibold text-[22px] mt-6 mb-3 tracking-tight">
                {children}
              </h1>
            );
          },
          h2({ children }: any) {
            return (
              <h2 className="text-[#0f172a] font-semibold text-[19px] mt-5 mb-2.5 tracking-tight">
                {children}
              </h2>
            );
          },
          h3({ children }: any) {
            return (
              <h3 className="text-[#0f172a] font-semibold text-[16px] mt-4 mb-2 tracking-tight">
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
              <div className="my-4 overflow-x-auto rounded-lg border border-[#2563eb]/10">
                <table className="border-collapse w-full text-[14px]">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }: any) {
            return (
              <th className="border-b border-[#2563eb]/20 bg-[#2563eb]/[0.04] text-right px-3 py-2 font-semibold text-[#0f172a]">
                {children}
              </th>
            );
          },
          td({ children }: any) {
            return (
              <td className="border-b border-[#7f90a8]/15 text-right px-3 py-2 text-[#435569]">
                {children}
              </td>
            );
          },
          hr() {
            return (
              <hr className="my-6 border-0 h-px bg-gradient-to-r from-transparent via-[#2563eb]/20 to-transparent" />
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
