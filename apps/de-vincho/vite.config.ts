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
            p.on("proxyReq", (proxyReq) => {
              // Some providers (e.g. Pollinations) serve a deprecation notice
              // instead of real output when they see a browser-origin request.
              // Stripping these makes the relay indistinguishable from a
              // server-to-server call.
              proxyReq.removeHeader("origin");
              proxyReq.removeHeader("referer");
            });
            p.on("error", (err) => {
              console.error("[llm-proxy] upstream error:", err.message);
            });
          },
        },
      }
    : undefined;

  const port = Number(env.VITE_PORT) || 5173;

  return {
    plugins: [react()],
    // Without this, Vite pre-bundles the workspace core package and HMR on
    // core-source edits goes stale.
    optimizeDeps: { exclude: ["@sniro/chatbot-core"] },
    server: { port, open: true, proxy },
    preview: { port, proxy },
  };
});
