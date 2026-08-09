import { createInterface } from "node:readline/promises";

import { readCredentialFile } from "./admin-credentials.ts";

async function readHidden(label: string): Promise<string> {
  if (!process.stdin.setRawMode) throw new Error("INTERACTIVE_INPUT_UNAVAILABLE");
  process.stderr.write(`${label}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        const code = character.codePointAt(0);
        if (code === 3) return finish(new Error("INPUT_CANCELLED"));
        if (code === 10 || code === 13) return finish();
        if (code === 8 || code === 127) value = Array.from(value).slice(0, -1).join("");
        else if ((code ?? 0) >= 32 && Array.from(value).length < 512) value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

export async function readCredential(
  label: string,
  fileEnvironmentName: string,
  hidden = false,
): Promise<string> {
  const file = process.env[fileEnvironmentName];
  if (file) return readCredentialFile(file);
  if (!process.stdin.isTTY) throw new Error(`${fileEnvironmentName}_REQUIRED`);
  if (hidden) return readHidden(label);
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await prompt.question(`${label}: `)).trim();
  } finally {
    prompt.close();
  }
}
