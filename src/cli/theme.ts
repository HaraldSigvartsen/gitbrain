/** Minimal ANSI styling — no runtime dependencies. Disabled when not on a TTY (unless forced). */

export interface CliTheme {
  readonly enabled: boolean;
  success(text: string): string;
  warning(text: string): string;
  error(text: string): string;
  dim(text: string): string;
}

const RESET = "\u001b[0m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";
const DIM = "\u001b[2m";

function wrap(code: string, text: string, enabled: boolean): string {
  return enabled ? `${code}${text}${RESET}` : text;
}

export function createTheme(enabled: boolean): CliTheme {
  return {
    enabled,
    success: (text) => wrap(GREEN, text, enabled),
    warning: (text) => wrap(YELLOW, text, enabled),
    error: (text) => wrap(RED, text, enabled),
    dim: (text) => wrap(DIM, text, enabled),
  };
}

export interface ColorPreference {
  /** Commander sets this when `--color` / `--no-color` is passed. */
  color?: boolean;
}

/** Respect https://no-color.org/ and common FORCE_COLOR conventions. */
export function shouldUseColor(preference: ColorPreference = {}): boolean {
  if (preference.color === false) return false;
  if (preference.color === true) return true;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY);
}

/** Colour a leading marker when the rest of the line stays plain. */
export function paintLeadingMarker(line: string, marker: string, paint: (s: string) => string): string {
  if (!line.startsWith(marker)) return line;
  return paint(marker) + line.slice(marker.length);
}
