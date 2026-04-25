import { spawn } from "node:child_process";

// Opens `url` in the user's default browser, detaching so the launcher doesn't
// sit waiting on the browser process. Windows-only for now — the compiled
// binary targets bun-windows-x64. If spawn fails, we swallow and let the
// caller print the URL so the user can paste it manually.
export function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      // `start` is a cmd.exe builtin, not a standalone executable. The empty
      // "" after it is the window title (otherwise cmd treats the URL as the
      // title).
      spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } else if (platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // Intentional: caller logs the URL regardless.
  }
}
