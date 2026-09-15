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
 * The "Setup - Call Summary + Satisfaction Structured Output" workflow linked
 * a Vapi Structured Output resource to the assistant. Vapi attaches the result
 * under call.analysis.structuredData keyed by the schema name, OR under
 * call.artifact.structuredOutputs depending on API version — try both.
 * VERIFY the actual key against a real completed call before relying on this.
 */
/**
 * Confirmed against Vapi's official docs (docs.vapi.ai/assistants/call-analysis):
 * call.analysis.summary is the plain call summary, and call.analysis.structuredData
 * holds whatever fields were configured in assistant.analysisPlan.structuredDataPlan
 * (or a linked Structured Output resource) — in this case the satisfaction
 * sub-scores. There is no artifact.structuredOutputs field; that was an earlier
 * unverified guess and has been removed.
 */
export function extractSummaryAndSatisfaction(call: any): {
  callSummary: string | undefined;
  satisfaction: { clarity: number | null; tone: number | null; resolution: number | null; overall: number | null } | null;
} {
  const summary: string | undefined = call?.analysis?.summary;
  const structuredData = call?.analysis?.structuredData;

  const satisfaction = structuredData
    ? {
        clarity: structuredData.clarity ?? null,
        tone: structuredData.tone ?? null,
        resolution: structuredData.resolution ?? null,
        overall: structuredData.overall ?? structuredData.overall_score ?? null,
      }
    : null;

  return { callSummary: summary, satisfaction };
}

/**
 * Vapi's transcript comes back as one plain-text block with "AI: ..." /
 * "User: ..." (or "Assistant:"/"Customer:") line prefixes. Split it into
 * the { role, text }[] shape the dashboard's transcript viewer expects.
 */
export function parseTranscript(transcript: string | undefined): { role: "assistant" | "client"; text: string }[] {
  if (!transcript) return [];
  const lines = transcript.split("\n").filter((l) => l.trim().length > 0);
  const turns: { role: "assistant" | "client"; text: string }[] = [];

  for (const line of lines) {
    const match = line.match(/^(AI|Assistant|User|Customer|Client)\s*:\s*(.*)$/i);
    if (match) {
      const roleRaw = match[1]?.toLowerCase() || "";
      const role: "assistant" | "client" = roleRaw === "ai" || roleRaw === "assistant" ? "assistant" : "client";
      turns.push({ role, text: (match[2] || "").trim() });
    } else if (turns.length > 0) {
      // Continuation of the previous turn (no new speaker prefix on this line)
      const last = turns[turns.length - 1];
      if (last) last.text += " " + line.trim();
    }
  }
  return turns;
}
