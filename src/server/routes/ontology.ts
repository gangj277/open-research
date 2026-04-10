import { Hono } from "hono";

export function createOntologyRoutes() {
  const app = new Hono();

  app.get("/status", async (c) => {
    const workspaceDir = c.req.query("workspaceDir") ?? process.cwd();
    const [{ loadOntology }, { getOntologyStatus }] = await Promise.all([
      import("@/lib/ontology/store"),
      import("@/lib/ontology/status"),
    ]);
    const ontology = await loadOntology(workspaceDir);
    const noteCount = ontology.notes.length;
    const edgeCount = ontology.notes.reduce((sum, n) => sum + n.edges.length, 0);
    const summary = getOntologyStatus(ontology);
    return c.json({ noteCount, edgeCount, summary });
  });

  return app;
}
