/**
 * Reads an environment variable, treating blank as unset.
 *
 * `.env` files are full of `KEY=` lines -- a documented variable left empty
 * because it is optional. But `process.env.KEY` is then the empty string, and
 * `??` only falls back on undefined, so every `process.env.KEY ?? fallback`
 * quietly takes the empty string instead of the default.
 *
 * That is not hypothetical: `NEXT_DIST_DIR=` in a .env copied from the example
 * produced `distDir: ""` and broke `next build` on a fresh VPS with an error
 * that named neither the variable nor the file.
 *
 * Whitespace is trimmed too, because `KEY= ` and a trailing space after a value
 * are both things that happen when a file is edited over SSH.
 */
export function env(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The same, with a fallback for when the variable is missing or blank. */
export function envOr(name: string, fallback: string): string {
  return env(name) ?? fallback;
}
