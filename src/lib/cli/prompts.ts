import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
