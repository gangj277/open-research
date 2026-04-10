import { Hono } from "hono";
import { listAvailableSkills } from "@/lib/skills/registry";

export function createSkillRoutes(options?: { homeDir?: string }) {
  const app = new Hono();

  app.get("/", async (c) => {
    const skills = await listAvailableSkills(options);
    return c.json(skills);
  });

  return app;
}
