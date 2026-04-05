import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { latexToHtml } from "./latex-to-html";

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Open Research — LaTeX Preview</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
    onload="renderMathInElement(document.body, {
      delimiters: [
        {left: '\\\\[', right: '\\\\]', display: true},
        {left: '\\\\(', right: '\\\\)', display: false}
      ],
      throwOnError: false
    });">
  </script>
  <style>
    :root {
      --bg: #1a1a2e;
      --surface: #16213e;
      --text: #e0e0e0;
      --text-dim: #8892b0;
      --accent: #64ffda;
      --heading: #ccd6f6;
      --citation: #64ffda;
      --border: #233554;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Charter', 'Georgia', 'Times New Roman', serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.8;
      max-width: 780px;
      margin: 0 auto;
      padding: 3rem 2rem;
    }
    h1.title {
      font-size: 2rem;
      color: var(--heading);
      text-align: center;
      margin-bottom: 0.5rem;
      line-height: 1.3;
    }
    .author {
      text-align: center;
      color: var(--text-dim);
      font-style: italic;
      margin-bottom: 0.3rem;
    }
    .date {
      text-align: center;
      color: var(--text-dim);
      margin-bottom: 2rem;
    }
    .abstract {
      background: var(--surface);
      border-left: 3px solid var(--accent);
      padding: 1.2rem 1.5rem;
      margin: 2rem 0;
      border-radius: 0 4px 4px 0;
    }
    .abstract h3 {
      color: var(--accent);
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 0.5rem;
    }
    h2.section {
      font-size: 1.4rem;
      color: var(--heading);
      margin: 2.5rem 0 1rem;
      padding-bottom: 0.3rem;
      border-bottom: 1px solid var(--border);
    }
    h3.subsection {
      font-size: 1.15rem;
      color: var(--heading);
      margin: 1.8rem 0 0.8rem;
    }
    h4.subsubsection {
      font-size: 1rem;
      color: var(--text-dim);
      margin: 1.2rem 0 0.5rem;
    }
    p { margin: 0.8rem 0; }
    strong { color: var(--heading); }
    code {
      background: var(--surface);
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      font-size: 0.9em;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }
    pre {
      background: var(--surface);
      padding: 1rem;
      border-radius: 4px;
      overflow-x: auto;
      margin: 1rem 0;
    }
    pre code { background: none; padding: 0; }
    blockquote {
      border-left: 3px solid var(--border);
      padding-left: 1rem;
      color: var(--text-dim);
      font-style: italic;
      margin: 1rem 0;
    }
    ul, ol { padding-left: 1.5rem; margin: 0.8rem 0; }
    li { margin: 0.3rem 0; }
    .citation {
      color: var(--citation);
      font-weight: 500;
      cursor: help;
    }
    .ref { color: var(--accent); font-style: italic; }
    .footnote { color: var(--accent); cursor: help; }
    .math-display {
      margin: 1.2rem 0;
      overflow-x: auto;
      text-align: center;
    }
    .figure-placeholder, .table-placeholder {
      background: var(--surface);
      border: 1px dashed var(--border);
      padding: 2rem;
      margin: 1.5rem 0;
      text-align: center;
      border-radius: 4px;
    }
    .figure-placeholder::before { content: '[Figure placeholder]'; display: block; color: var(--text-dim); margin-bottom: 0.5rem; }
    .table-placeholder::before { content: '[Table placeholder]'; display: block; color: var(--text-dim); margin-bottom: 0.5rem; }
    figcaption { font-style: italic; color: var(--text-dim); font-size: 0.9rem; }

    /* Live reload indicator */
    .live-badge {
      position: fixed;
      top: 1rem;
      right: 1rem;
      background: #0d7337;
      color: white;
      padding: 0.3rem 0.8rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-family: sans-serif;
      opacity: 0.8;
    }
    .live-badge.disconnected { background: #7d3030; }
  </style>
</head>
<body>
  <div class="live-badge" id="status">LIVE</div>
  <div id="content">
    {{CONTENT}}
  </div>
  <script>
    // Auto-reload via polling (simple, no WebSocket dependency)
    let lastHash = "";
    async function checkForUpdates() {
      try {
        const res = await fetch("/__hash");
        const hash = await res.text();
        if (lastHash && hash !== lastHash) {
          location.reload();
        }
        lastHash = hash;
        document.getElementById("status").textContent = "LIVE";
        document.getElementById("status").className = "live-badge";
      } catch {
        document.getElementById("status").textContent = "DISCONNECTED";
        document.getElementById("status").className = "live-badge disconnected";
      }
    }
    setInterval(checkForUpdates, 1000);
    checkForUpdates();
  </script>
</body>
</html>`;

export interface PreviewServer {
  url: string;
  port: number;
  close: () => void;
}

/**
 * Start a live preview server for a LaTeX file.
 * Auto-reloads the browser when the file changes.
 */
export function startPreviewServer(texPath: string): Promise<PreviewServer> {
  const resolved = path.resolve(texPath);
  let currentHash = "";

  function getContentHash(): string {
    try {
      const content = fs.readFileSync(resolved, "utf8");
      // Simple hash: length + first/last 100 chars
      return `${content.length}-${content.slice(0, 100)}-${content.slice(-100)}`;
    } catch {
      return "error";
    }
  }

  function renderPage(): string {
    try {
      const latex = fs.readFileSync(resolved, "utf8");
      const htmlContent = latexToHtml(latex);
      currentHash = getContentHash();
      return HTML_TEMPLATE.replace("{{CONTENT}}", htmlContent);
    } catch (err) {
      return HTML_TEMPLATE.replace(
        "{{CONTENT}}",
        `<p style="color: #ff6b6b;">Error reading ${resolved}: ${err instanceof Error ? err.message : String(err)}</p>`
      );
    }
  }

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/__hash") {
        const hash = getContentHash();
        res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-cache" });
        res.end(hash);
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(renderPage());
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return;
      const port = addr.port;
      const url = `http://127.0.0.1:${port}`;
      resolve({
        url,
        port,
        close: () => server.close(),
      });
    });
  });
}
