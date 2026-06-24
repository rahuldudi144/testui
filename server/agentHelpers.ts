import type { Message } from "../../types/index.js";

export function extractSqlFromMarkdown(markdown: string): string | undefined {
  const fenced = markdown.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  return undefined;
}

export function toAgentMessages(
  rows: { role: string; content: string }[],
): Message[] {
  return rows
    .filter(
      (r) =>
        r.role === "user" || r.role === "assistant" || r.role === "system",
    )
    .map((r) => ({
      role: r.role as Message["role"],
      content: r.content,
    }));
}
