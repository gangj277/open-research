function getStableDimension(current: unknown, fallback: number): number {
  return typeof current === "number" && current > 0 ? current : fallback;
}

/**
 * Preserve the last usable terminal dimensions so Ink doesn't fall into
 * fullscreen redraw mode when terminals briefly report zero-sized tabs.
 *
 * A legacy full-redraw path is still available for terminals that need it.
 */
export function createStableInkStdout(
  stdout: NodeJS.WriteStream,
  options?: { forceFullRedraw?: boolean },
): NodeJS.WriteStream {
  const forceFullRedraw =
    options?.forceFullRedraw ??
    process.env.OPEN_RESEARCH_FORCE_FULL_REDRAW === "1";
  let lastRows = getStableDimension((stdout as { rows?: number }).rows, 24);
  let lastColumns = getStableDimension((stdout as { columns?: number }).columns, 80);

  return new Proxy(stdout, {
    get(target, prop, receiver) {
      if (prop === "rows") {
        if (forceFullRedraw) {
          return 0;
        }

        const rows = Reflect.get(target, prop, receiver);
        lastRows = getStableDimension(rows, lastRows);
        return lastRows;
      }

      if (prop === "columns") {
        const columns = Reflect.get(target, prop, receiver);
        lastColumns = getStableDimension(columns, lastColumns);
        return lastColumns;
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as NodeJS.WriteStream;
}
