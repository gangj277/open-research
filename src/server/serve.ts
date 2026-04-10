import { serve } from "@hono/node-server";
import { createApp } from "./index";

const port = parseInt(process.env.PORT ?? "3210", 10);
const { app } = createApp();

console.log(`Open Research server listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
