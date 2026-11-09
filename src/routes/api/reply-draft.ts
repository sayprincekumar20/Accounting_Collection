import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/lib/env";

const actions = [
  "generate",
  "professional",
  "translate-to-english",
  "translate-to-filipino",
  "shorten",
  "grammar",
] as const;
type DraftAction = (typeof actions)[number];
type DraftChannel = "email" | "sms" | "viber" | "whatsapp";

export const Route = createFileRoute("/api/reply-draft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            action?: string;
            channel?: string;
            message?: string;
            conversation?: { role?: string; content?: string }[];
          };
          if (!actions.includes(body.action as DraftAction)) {
            return Response.json({ error: "Unsupported draft action" }, { status: 400 });
          }
          if (!["email", "sms", "viber", "whatsapp"].includes(body.channel || "")) {
            return Response.json({ error: "Unsupported message channel" }, { status: 400 });
          }
          const action = body.action as DraftAction;
          const channel = body.channel as DraftChannel;
          const message = String(body.message || "").trim();
          const conversation = (Array.isArray(body.conversation) ? body.conversation : [])
            .filter(
              (item) =>
                item &&
                (item.role === "assistant" || item.role === "user") &&
                typeof item.content === "string",
            )
            .slice(-20)
            .map((item) => ({
              role: item.role as "assistant" | "user",
              content: item.content!.slice(0, 2000),
            }));

          if (action !== "generate" && !message) {
            return Response.json(
              { error: "Enter a draft before choosing this writing action" },
              { status: 400 },
            );
          }
          if (action === "generate" && !conversation.length) {
            return Response.json(
              { error: "There is no conversation history to draft a reply from" },
              { status: 400 },
            );
          }
          if (message.length > 6000) {
            return Response.json({ error: "Draft text is too long to process" }, { status: 413 });
          }

          const apiKey = await getEnv("OPENAI_API_KEY");
          if (!apiKey) {
            return Response.json({ error: "AI drafting is not configured" }, { status: 503 });
          }
          const model = (await getEnv("OPENAI_MODEL")) || "gpt-4.1";
          const instructions: Record<DraftAction, string> = {
            generate: `Draft a concise, professional ${channel} reply based only on the supplied conversation. Do not invent amounts, dates, payment commitments, or facts. Ask a clear next-step question if appropriate. Return only the message draft.`,
            professional:
              "Rewrite the supplied draft in a clear, courteous, professional accounts-receivable tone. Preserve its meaning and all factual details. Return only the revised draft.",
            "translate-to-english":
              "Translate the supplied draft into natural English. Preserve its meaning, amounts, dates, names, and tone. Return only the translation.",
            "translate-to-filipino":
              "Translate the supplied draft into natural Filipino. Preserve its meaning, amounts, dates, names, and tone. Return only the translation.",
            shorten:
              "Shorten the supplied draft while preserving its intent, key facts, amounts, and requested next step. Return only the revised draft.",
            grammar:
              "Correct grammar, spelling, and punctuation in the supplied draft without changing its meaning, facts, or tone. Return only the corrected draft.",
          };
          const messages = [
            {
              role: "system",
              content: `You help staff prepare editable customer-service drafts for a food supplier's accounts-receivable team. ${instructions[action]} Never send messages, claim they were sent, or add facts that are not in the supplied content.`,
            },
            ...(action === "generate" ? conversation : []),
            ...(action === "generate" ? [] : [{ role: "user" as const, content: message }]),
          ];
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 700 }),
          });
          const result = (await response.json().catch(() => ({}))) as {
            choices?: { message?: { content?: string } }[];
            error?: { message?: string };
          };
          if (!response.ok) {
            console.error("[reply-draft] model request failed:", response.status, result.error);
            return Response.json(
              { error: "Could not generate a draft right now. Please try again." },
              { status: 502 },
            );
          }
          const draft = result.choices?.[0]?.message?.content?.trim();
          if (!draft) {
            return Response.json({ error: "The AI returned an empty draft" }, { status: 502 });
          }
          return Response.json({ draft }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          console.error("[reply-draft] request failed:", error);
          return Response.json(
            { error: error instanceof Error ? error.message : "Could not generate a draft" },
            { status: 500 },
          );
        }
      },
    },
  },
});
