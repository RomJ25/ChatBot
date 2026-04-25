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
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
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
    const needsQuoting = /[\s#"']/.test(v);
    lines.push(`${k}=${needsQuoting ? JSON.stringify(v) : v}`);
  }
  return lines.join("\n") + "\n";
}
