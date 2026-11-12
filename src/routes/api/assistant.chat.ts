import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/lib/env";
import { runAction, toolDefinitions, type ActionContext } from "@/lib/assistant/registry";
import "@/lib/assistant/tools";

// AI assistant chat endpoint: OpenAI chat completions with the Action Registry as tools, streamed to the
// dashboard as server-sent events. Events: text, tool, working_set, ui, confirm, done, error.
type Msg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

const MAX_STEPS = 6;

function systemPrompt(ctx: ActionContext, workingLabel: string, extra: string): string {
  const now = new Date(Date.now() + 8 * 3600000).toISOString().replace("T", " ").slice(0, 16);
  return [
    "You are the operations assistant of the Rare Global Food AR collections dashboard (accounts receivable,",
    "overdue invoices, reminders by email / SMS / Viber / WhatsApp, calls by the voice agent Grace, approvals, promises).",
    `Now (Manila): ${now}. User: ${ctx.userName || "dashboard user"}. Current page: ${ctx.page || "/"}.${extra}`,
    `Working set (result of the previous search): ${ctx.workingSet.length ? ctx.workingSet.length + " clients (" + workingLabel + ")" : "none"}.`,
    "Rules:",
    "- Always get facts from the tools; never invent clients, amounts, dates or statuses. If a tool returns nothing, say so.",
    "- Follow-up questions about 'them', 'these', 'those clients' or a narrower filter: call the tool with use_working_set=true.",
    "- Present lists as concise markdown tables (amounts as PHP 1,234.56); totals first, then the table; max ~25 rows, then say how many more.",
    "- When the user asks to open / show / go to a page or a client, call navigate.",
    "- For questions about system or workflow problems (SMS phone, credit, stuck queues, failing runs) call workflow_health.",
    "- Actions that send messages, call clients or change data need the user's confirmation; the dashboard asks them. Do not claim an action ran unless the tool result says so.",
    "- The reminder cycle runs Wednesday to Tuesday; approvals are valid for the current cycle only.",
    "- Be brief and businesslike. Answer in the user's language.",
  ].join("\n");
}

async function* openaiStream(
  apiKey: string,
  model: string,
  messages: Msg[],
): AsyncGenerator<{ text?: string; calls?: ToolCall[] }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      tools: toolDefinitions(),
      tool_choice: "auto",
      stream: true,
      temperature: 0.2,
    }),
  });
  if (!res.ok || !res.body)
    throw new Error(
      `OpenAI error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`,
    );
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const calls: { id: string; name: string; args: string }[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let j: {
        choices?: {
          delta?: {
            content?: string;
            tool_calls?: {
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
      };
      try {
        j = JSON.parse(payload);
      } catch {
        continue;
      }
      const d = j.choices?.[0]?.delta;
      if (!d) continue;
      if (d.content) yield { text: d.content };
      for (const tc of d.tool_calls ?? []) {
        const c = (calls[tc.index] ||= { id: "", name: "", args: "" });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
      }
    }
  }
  if (calls.length)
    yield {
      calls: calls.filter(Boolean).map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.args || "{}" },
      })),
    };
}

export const Route = createFileRoute("/api/assistant/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: {
          messages?: { role: string; content: string }[];
          context?: {
            page?: string;
            client?: string;
            workingSet?: { ids?: string[]; label?: string };
          };
          user_name?: string;
          session_id?: string;
          confirm?: { id: string; args: unknown };
        };
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 });
        }
        const apiKey = await getEnv("OPENAI_API_KEY");
        if (!apiKey)
          return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured" }), {
            status: 503,
          });
        const model = (await getEnv("OPENAI_MODEL")) || "gpt-4.1";
        const ws = body.context?.workingSet ?? {};
        const ctx: ActionContext = {
          userName: String(body.user_name || "dashboard user").slice(0, 80),
          sessionId: String(body.session_id || "").slice(0, 80),
          page: String(body.context?.page || "/").slice(0, 200),
          workingSet: (ws.ids ?? []).map(String).slice(0, 2000),
        };
        const extra = body.context?.client
          ? ` The user is looking at client: ${String(body.context.client).slice(0, 200)}.`
          : "";
        const history: Msg[] = (body.messages ?? [])
          .filter(
            (m) =>
              m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
          )
          .slice(-16)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content.slice(0, 6000),
          }));
        if (!history.length && !body.confirm)
          return new Response(JSON.stringify({ error: "no message" }), { status: 400 });

        const stream = new TransformStream<Uint8Array, Uint8Array>();
        const writer = stream.writable.getWriter();
        const enc = new TextEncoder();
        const send = (ev: Record<string, unknown>) =>
          writer.write(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));

        (async () => {
          try {
            let workingLabel = String(ws.label || "");
            const messages: Msg[] = [
              { role: "system", content: systemPrompt(ctx, workingLabel, extra) },
              ...history,
            ];
            // A confirmed write action from the previous turn: run it now and let the model report the result.
            if (body.confirm) {
              await send({ type: "tool", id: body.confirm.id, status: "running" });
              const r = await runAction(body.confirm.id, body.confirm.args, ctx, true);
              await send({
                type: "tool",
                id: body.confirm.id,
                status: r.ok ? "done" : "error",
                summary: r.ok ? r.result?.summary : r.error,
              });
              if (r.ok && r.result?.workingSet)
                await send({ type: "working_set", ...r.result.workingSet });
              if (r.ok && r.result?.ui) await send({ type: "ui", ...r.result.ui });
              messages.push({
                role: "user",
                content: `[The user confirmed the action ${body.confirm.id}. Result: ${JSON.stringify(r.ok ? r.result?.data : { error: r.error }).slice(0, 8000)}] Report the outcome briefly.`,
              });
            }
            for (let step = 0; step < MAX_STEPS; step++) {
              let calls: ToolCall[] = [];
              let text = "";
              for await (const chunk of openaiStream(apiKey, model, messages)) {
                if (chunk.text) {
                  text += chunk.text;
                  await send({ type: "text", delta: chunk.text });
                }
                if (chunk.calls) calls = chunk.calls;
              }
              if (!calls.length) break;
              messages.push({ role: "assistant", content: text || null, tool_calls: calls });
              for (const call of calls) {
                let args: unknown = {};
                try {
                  args = JSON.parse(call.function.arguments || "{}");
                } catch {
                  args = {};
                }
                await send({ type: "tool", id: call.function.name, status: "running" });
                const r = await runAction(call.function.name, args, ctx);
                if (r.needsConfirmation) {
                  await send({ type: "confirm", ...r.needsConfirmation });
                  messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    content: JSON.stringify({
                      status: "awaiting_user_confirmation",
                      note: "The dashboard is asking the user to confirm. Tell the user what will happen and that they must confirm.",
                    }),
                  });
                  continue;
                }
                await send({
                  type: "tool",
                  id: call.function.name,
                  status: r.ok ? "done" : "error",
                  summary: r.ok ? r.result?.summary : r.error,
                });
                if (r.ok && r.result?.workingSet) {
                  ctx.workingSet = r.result.workingSet.ids;
                  workingLabel = r.result.workingSet.label;
                  await send({ type: "working_set", ...r.result.workingSet });
                }
                if (r.ok && r.result?.ui) await send({ type: "ui", ...r.result.ui });
                messages.push({
                  role: "tool",
                  tool_call_id: call.id,
                  content: JSON.stringify(r.ok ? r.result?.data : { error: r.error }).slice(
                    0,
                    24000,
                  ),
                });
              }
            }
            await send({ type: "done" });
          } catch (e) {
            await send({ type: "error", message: e instanceof Error ? e.message : String(e) });
          } finally {
            await writer.close();
          }
        })();

        return new Response(stream.readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
