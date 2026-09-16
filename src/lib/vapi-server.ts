// src/lib/vapi-server.ts
// SERVER-ONLY. Uses VAPI_PRIVATE_KEY — must never reach the client bundle.
//
// Env vars required (server-side, NOT VITE_-prefixed):
//   VAPI_PRIVATE_KEY
//   VAPI_ASSISTANT_ID   (optional filter — omit to list calls across all assistants)

import { getEnv } from "@/lib/env";

const VAPI_API = "https://api.vapi.ai";

async function authHeaders() {
  return { Authorization: `Bearer ${(await getEnv("VAPI_PRIVATE_KEY")) || ""}` };
}

export async function vapiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${VAPI_API}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...(init.headers || {}) },
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
 * CONFIRMED against real call data from the Vapi dashboard (structured output
 * named "Voice Call Summary and Satisfaction"): the result object has
 * `summary`, `satisfaction_tone`, `satisfaction_clarity`, `satisfaction_overall`,
 * `satisfaction_resolution` - all nested inside
 * call.artifact.structuredOutputs[outputId].result. There is no
 * call.analysis.summary for these calls; the summary lives inside this same
 * structured output alongside the scores, not on the analysis object at all.
 */
export function extractSummaryAndSatisfaction(call: any): {
  callSummary: string | undefined;
  satisfaction: { clarity: number | null; tone: number | null; resolution: number | null; overall: number | null } | null;
} {
  const structuredOutputs = call?.artifact?.structuredOutputs;
  let result: any = null;
  if (structuredOutputs && typeof structuredOutputs === "object") {
    for (const value of Object.values(structuredOutputs)) {
      const r = (value as any)?.result;
      if (r && typeof r === "object") {
        result = r;
        break;
      }
    }
  }

  // Fallback for calls that might use the legacy analysisPlan instead
  const legacy = call?.analysis?.structuredData;

  const summary: string | undefined = result?.summary || call?.analysis?.summary || legacy?.summary;

  const satisfaction = result
    ? {
        clarity: result.satisfaction_clarity ?? null,
        tone: result.satisfaction_tone ?? null,
        resolution: result.satisfaction_resolution ?? null,
        overall: result.satisfaction_overall ?? null,
      }
    : legacy
      ? {
          clarity: legacy.clarity ?? null,
          tone: legacy.tone ?? null,
          resolution: legacy.resolution ?? null,
          overall: legacy.overall ?? null,
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
