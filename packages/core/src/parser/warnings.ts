/**
 * Non-fatal diagnostics collected while parsing a single configuration
 * (unknown format element types, unrecognised datasource handlers, ...).
 * `buildConfiguration` runs each parse inside `collectParseWarnings` and
 * attaches the result to `ERConfiguration.warnings` when non-empty.
 *
 * Collectors form a stack, so a nested collection (a parse started from
 * inside another one) gets its own buffer and the outer one is restored
 * afterwards, even when the inner parse throws.
 */
const collectors: string[][] = [];

/** Runs `fn` with a fresh warning buffer and returns its result together with the warnings it pushed. */
export function collectParseWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  collectors.push(warnings);
  try {
    return { result: fn(), warnings };
  } finally {
    collectors.pop();
  }
}

/** Records `message` once in the active collector; a no-op outside `collectParseWarnings`. */
export function pushParseWarning(message: string): void {
  const active = collectors[collectors.length - 1];
  if (active && !active.includes(message)) active.push(message);
}
