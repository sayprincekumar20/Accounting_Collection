// src/lib/vapi-server.ts
// SERVER-ONLY. Uses VAPI_PRIVATE_KEY — must never reach the client bundle.
//
// Env vars required (server-side, NOT VITE_-prefixed):
//   VAPI_PRIVATE_KEY
//   VAPI_ASSISTANT_ID   (optional filter — omit to list calls across all assistants)

const VAPI_API = "https://api.vapi.ai";

function authHeaders() {
  return { Authorization: `Bearer ${process.env["VAPI_PRIVATE_KEY"] || ""}` };
}

export async function vapiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${VAPI_API}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vapi API ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * client_id was injected as a call variable when 00C_Directory_Sheet_Data_Fetch
 * (or the voice dispatcher) triggered the call. Vapi echoes it back in a couple
 * of possible spots depending on how the call was placed — check all of them.
 * VERIFY against one real call payload from your Vapi dashboard before trusting
 * this in production; adjust the lookup chain if the actual key differs.
 */
export function extractClientId(call: any): string {
  return (
    call?.assistantOverrides?.variableValues?.client_id ||
    call?.variableValues?.client_id ||
    call?.metadata?.client_id ||
    ""
  );
}

export function extractClientName(call: any): string {
  return (
    call?.assistantOverrides?.variableValues?.client_name ||
    call?.variableValues?.client_name ||
    call?.metadata?.client_name ||
    ""
  );
}

/**
 * Vapi has TWO separate systems that can produce this data, and which one
 * is active depends entirely on how the assistant was configured:
 *
 * 1. Legacy `assistant.analysisPlan` -> call.analysis.summary (plain string)
 *    and call.analysis.structuredData (flat object, single schema).
 * 2. Newer named "Structured Outputs" resources (confirmed at
 *    docs.vapi.ai/assistants/structured-outputs-quickstart) -> each one's
 *    result lands at call.artifact.structuredOutputs[outputId].result,
 *    keyed by the output's ID, which we don't know in advance.
 *
 * The n8n workflow that set this up was literally named "Call Summary +
 * Satisfaction Structured Output" (capital S, matching system 2's naming),
 * so that's checked first, with system 1 as a fallback.
 */
export function extractSummaryAndSatisfaction(call: any): {
  callSummary: string | undefined;
  satisfaction: { clarity: number | null; tone: number | null; resolution: number | null; overall: number | null } | null;
} {
  // System 2: newer Structured Outputs, keyed by an output ID we don't know —
  // take the first result that actually looks like a satisfaction payload.
  const structuredOutputs = call?.artifact?.structuredOutputs;
  let outputResult: any = null;
  if (structuredOutputs && typeof structuredOutputs === "object") {
    for (const value of Object.values(structuredOutputs)) {
      const result = (value as any)?.result;
      if (result && typeof result === "object") {
        outputResult = result;
        break;
      }
    }
  }

  // System 1: legacy analysisPlan structured data
  const legacyStructuredData = call?.analysis?.structuredData;

  const structured = outputResult || legacyStructuredData;

  const summary: string | undefined = call?.analysis?.summary || structured?.summary;

  const satisfaction = structured
    ? {
        clarity: structured.clarity ?? null,
        tone: structured.tone ?? null,
        resolution: structured.resolution ?? null,
        overall: structured.overall ?? structured.overall_score ?? null,
      }
    : null;

  return { callSummary: summary, satisfaction };
}

/**
 * Confirmed against Vapi's List Calls API reference: call.artifact.messages
 * is a structured array with a `role` and `message` (not `content`) field
 * per turn, plus secondsFromStart/time. This is far more reliable than
 * regex-parsing the flat call.transcript text block, which was the
 * earlier (unverified) approach and is why the transcript viewer was
 * coming back empty.
 */
export function parseTranscript(call: any): { role: "assistant" | "client"; text: string }[] {
  const messages = call?.artifact?.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    return messages
      .filter((m: any) => m?.message && typeof m.message === "string" && m.message.trim().length > 0)
      // "system" is the instructions given TO the assistant, not something spoken during
      // the call - it must never appear in the transcript. Same for tool/function call
      // messages, which aren't spoken dialogue either.
      .filter((m: any) => {
        const roleRaw = String(m.role || "").toLowerCase();
        return roleRaw !== "system" && roleRaw !== "tool" && roleRaw !== "function" && roleRaw !== "tool_calls";
      })
      .map((m: any) => {
        const roleRaw = String(m.role || "").toLowerCase();
        const role: "assistant" | "client" = roleRaw === "bot" || roleRaw === "assistant" ? "assistant" : "client";
        return { role, text: m.message.trim() };
      });
  }

  // Fallback: some older calls may only have the flat transcript string.
  const transcript: string | undefined = call?.transcript || call?.artifact?.transcript;
  if (!transcript) return [];

  const lines = transcript.split("\n").filter((l: string) => l.trim().length > 0);
  const turns: { role: "assistant" | "client"; text: string }[] = [];
  for (const line of lines) {
    const match = line.match(/^(AI|Assistant|User|Customer|Client|Bot)\s*:\s*(.*)$/i);
    if (match) {
      const roleRaw = match[1]?.toLowerCase() || "";
      const role: "assistant" | "client" = roleRaw === "ai" || roleRaw === "assistant" || roleRaw === "bot" ? "assistant" : "client";
      turns.push({ role, text: (match[2] || "").trim() });
    } else if (turns.length > 0) {
      const last = turns[turns.length - 1];
      if (last) last.text += " " + line.trim();
    }
  }
  return turns;
}
