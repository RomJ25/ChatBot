import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const upstream = env.LLM_UPSTREAM?.trim();

  const proxy: Record<string, ProxyOptions> | undefined = upstream
    ? {
        "/api/llm": {
          target: upstream,
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/api\/llm/, ""),
          configure: (p) => {
            p.on("error", (err) => {
              console.error("[llm-proxy] upstream error:", err.message);
            });
          },
        },
      }
    : undefined;

  return {
    plugins: [react()],
    server: { port: 5173, open: true, proxy },
    preview: { port: 4173, proxy },
  };
});
