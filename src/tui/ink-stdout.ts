import { MIN_TERMINAL_WIDTH } from "@/tui/layout";

const RAW_COLUMNS = Symbol("open-research.raw-columns");
const RAW_ROWS = Symbol("open-research.raw-rows");

function getStableRow(current: unknown, fallback: number): number {
  return typeof current === "number" && current > 0 ? current : fallback;
}

function getStableColumn(current: unknown, fallback: number): number {
  return typeof current === "number" && current >= MIN_TERMINAL_WIDTH ? current : fallback;
}

function getRawDimension(current: unknown): number | undefined {
  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
}

export function getRawTerminalDimensions(stdout: {
  columns?: number;
  rows?: number;
}): { columns?: number; rows?: number } {
  const stream = stdout as {
    columns?: number;
    rows?: number;
    [RAW_COLUMNS]?: number;
    [RAW_ROWS]?: number;
  };

  return {
    columns: getRawDimension(stream[RAW_COLUMNS] ?? stream.columns),
    rows: getRawDimension(stream[RAW_ROWS] ?? stream.rows),
  };
}

export function hasRenderableTerminalDimensions(stdout: {
  columns?: number;
  rows?: number;
}): boolean {
  const { columns, rows } = getRawTerminalDimensions(stdout);
  const hasRows = rows === undefined || rows > 0;
  return hasRows && typeof columns === "number" && columns >= MIN_TERMINAL_WIDTH;
}

/**
 * Preserve the last usable terminal dimensions so Ink doesn't fall into
 * fullscreen redraw mode when terminals briefly report invalid tab sizes.
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
  const initialRows = getRawDimension((stdout as { rows?: number }).rows);
  const initialColumns = getRawDimension((stdout as { columns?: number }).columns);
  let lastRows = getStableRow(initialRows, 24);
  let lastColumns = typeof initialColumns === "number" && initialColumns > 0
    ? Math.max(MIN_TERMINAL_WIDTH, initialColumns)
    : 80;
  const resizeListeners = new Map<(...args: unknown[]) => void, (...args: unknown[]) => void>();

  return new Proxy(stdout, {
    get(target, prop, receiver) {
      if (prop === RAW_ROWS) {
        return getRawDimension(Reflect.get(target, "rows", receiver));
      }

      if (prop === RAW_COLUMNS) {
        return getRawDimension(Reflect.get(target, "columns", receiver));
      }

      if (prop === "rows") {
        if (forceFullRedraw) {
          return 0;
        }

        const rows = Reflect.get(target, prop, receiver);
        lastRows = getStableRow(rows, lastRows);
        return lastRows;
      }

      if (prop === "columns") {
        const columns = Reflect.get(target, prop, receiver);
        lastColumns = getStableColumn(columns, lastColumns);
        return lastColumns;
      }

      if (prop === "on" || prop === "addListener" || prop === "once" || prop === "prependListener") {
        const method = prop;
        return (eventName: string | symbol, listener: (...args: unknown[]) => void) => {
          if (eventName === "resize" && !forceFullRedraw) {
            const wrapped = (...args: unknown[]) => {
              const rawColumns = getRawDimension(Reflect.get(target, "columns", receiver));
              const rawRows = getRawDimension(Reflect.get(target, "rows", receiver));

              lastColumns = getStableColumn(rawColumns, lastColumns);
              lastRows = getStableRow(rawRows, lastRows);

              if (!hasRenderableTerminalDimensions({
                [RAW_COLUMNS]: rawColumns,
                [RAW_ROWS]: rawRows,
              })) {
                return;
              }

              listener(...args);
            };

            resizeListeners.set(listener, wrapped);
            Reflect.get(target, method, receiver).call(target, eventName, wrapped);
            return receiver;
          }

          Reflect.get(target, method, receiver).call(target, eventName, listener);
          return receiver;
        };
      }

      if (prop === "off" || prop === "removeListener") {
        const method = prop;
        return (eventName: string | symbol, listener: (...args: unknown[]) => void) => {
          const wrapped = eventName === "resize" ? resizeListeners.get(listener) ?? listener : listener;
          resizeListeners.delete(listener);
          Reflect.get(target, method, receiver).call(target, eventName, wrapped);
          return receiver;
        };
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as NodeJS.WriteStream;
}
