// Minimal dotenv parser/serializer. No external deps; the launcher is a
// single compiled binary and shouldn't drag in the npm dotenv package.

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Windows Notepad writes UTF-8 files with a leading BOM by default; if the
  // user hand-edits their env file there, strip the BOM so the first key
  // doesn't end up as "\uFEFFLLM_UPSTREAM".
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    out[key] = unquote(line.slice(eq + 1).trim());
  }
  return out;
}

// Decode a value as written by `serializeEnv`. Double-quoted values were
// JSON-stringified, so JSON.parse them — that's what restores embedded
// newlines (`\n`), embedded quotes (`\"`), and backslashes from a multi-line
// system prompt typed into the launcher's setup textarea. Without this, a
// prompt like "line1\nline2" round-trips as the literal 7-char string
// `line1\nline2` and the model sees a corrupted instruction.
//
// Single-quoted values are passed through verbatim (POSIX-style: no escapes
// inside single quotes), matching standard dotenv conventions.
function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      // Hand-edited file with mismatched escapes — fall back to a plain
      // strip so the user gets *something* rather than a 500. The launcher
      // still validates parsed values before using them.
      return raw.slice(1, -1);
    }
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }
  return raw;
}

export function serializeEnv(
  map: Record<string, string>,
  header?: string,
): string {
  const lines: string[] = [];
  if (header) {
    for (const line of header.split(/\r?\n/)) lines.push(`# ${line}`);
    lines.push("");
  }
  for (const [k, v] of Object.entries(map)) {
    // JSON.stringify whenever the value would otherwise be ambiguous on
    // disk. \s in JS regex covers \n and \r, but listing them explicitly
    // documents the intent — mangled multi-line values are silently
    // catastrophic for system prompts. parseEnv → unquote() reverses this
    // with JSON.parse, so anything we JSON-encode here round-trips cleanly.
    const needsQuoting =
      /[\s#"'\\]/.test(v) || v.includes("\n") || v.includes("\r");
    lines.push(`${k}=${needsQuoting ? JSON.stringify(v) : v}`);
  }
  return lines.join("\n") + "\n";
}
