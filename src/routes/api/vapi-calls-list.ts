/* eslint-disable @typescript-eslint/no-explicit-any -- Vapi call payloads are untyped JSON (same as vapi-server.ts) */
import { createFileRoute } from "@tanstack/react-router";
import {
  vapiFetch,
  extractClientId,
  extractClientName,
  extractSummaryAndSatisfaction,
} from "@/lib/vapi-server";
import { getEnv } from "@/lib/env";

// Direct Vapi API call — replaces the old N8N_WEBHOOK_BASE_URL proxy.
// Same response shape as before: { calls: CallListItem[] } (+ `truncated`, `days`).
//
// Pages backwards in time with createdAtLt until it covers the requested window
// or hits MAX_CALLS, and says so when it stops early.
//
// Vapi only keeps call history for the plan's retention window (currently 14
// days) and REJECTS (400) any createdAtGt older than that. So the window is
// capped just inside 14 days, and if Vapi still rejects the date filter (e.g.
// after a plan change), the route falls back to plain newest-first paging
// without a date filter instead of failing the whole Voice tab.

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // 1,000 calls max per request
const RETENTION_DAYS = 14; // Vapi plan's call-history window
const DEFAULT_DAYS = RETENTION_DAYS;
const MAX_DAYS = RETENTION_DAYS;
const SAFETY_MS = 60 * 60 * 1000; // stay 1 hour inside the window

export const Route = createFileRoute("/api/vapi-calls-list")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const daysParam = Number(url.searchParams.get("days") || DEFAULT_DAYS);
          const days = Math.min(
            Math.max(Number.isFinite(daysParam) ? daysParam : DEFAULT_DAYS, 1),
            MAX_DAYS,
          );
          const since = new Date(Date.now() - days * 86400000 + SAFETY_MS).toISOString();
          const assistantId = await getEnv("VAPI_ASSISTANT_ID");

          const rawCalls: any[] = [];
          let before: string | undefined;
          let truncated = false;
          let useDateFilter = true;
          for (let page = 0; ; page++) {
            if (page >= MAX_PAGES) {
              truncated = true;
              console.warn(
                `[vapi-calls-list] more than ${MAX_PAGES * PAGE_SIZE} calls in ${days} days; truncated`,
              );
              break;
            }
            const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
            if (useDateFilter) qs.set("createdAtGt", since);
            if (assistantId) qs.set("assistantId", assistantId);
            if (before) qs.set("createdAtLt", before);
            let batch: any[];
            try {
              batch = (await vapiFetch<any[]>(`/call?${qs.toString()}`)) || [];
            } catch (err) {
              // Retention window rejected the date filter: retry this page without it.
              if (useDateFilter && /\(400\)/.test(String(err))) {
                console.warn(
                  "[vapi-calls-list] date filter rejected by Vapi, retrying without it:",
                  String(err).slice(0, 200),
                );
                useDateFilter = false;
                page--;
                continue;
              }
              throw err;
            }
            rawCalls.push(...batch);
            if (batch.length < PAGE_SIZE) break;
            // Next page: everything strictly older than the oldest call we have so far.
            const oldest = batch.reduce((min: string, c: any) => {
              const t = c.createdAt || c.startedAt || "";
              return t && (!min || t < min) ? t : min;
            }, "");
            if (!oldest || oldest === before) break;
            before = oldest;
          }

          // Real assistant names for the Assistant column (one request; falls back to the id).
          const assistantNames = new Map<string, string>();
          try {
            const assistants = (await vapiFetch<any[]>("/assistant?limit=100")) || [];
            for (const a of assistants) if (a?.id) assistantNames.set(a.id, String(a.name || "").trim());
          } catch (err) {
            console.warn("[vapi-calls-list] could not load assistant names:", String(err).slice(0, 200));
          }

          // Pages can overlap at the boundary timestamp; keep one entry per call id.
          const seen = new Set<string>();
          const unique = rawCalls.filter(
            (c) => c && c.id && !seen.has(c.id) && (seen.add(c.id), true),
          );

          const calls = unique.map((call) => {
            const { callSummary, satisfaction } = extractSummaryAndSatisfaction(call);
            const hasContent = !!(call.transcript || call.artifact?.transcript);
            const preview = (call.transcript || call.artifact?.transcript || "").slice(0, 140);

            return {
              call_id: call.id,
              client_id: extractClientId(call),
              client_name: extractClientName(call),
              phone: call.customer?.number || "",
              status: call.status || "",
              endedReason: call.endedReason || "",
              startedAt: call.startedAt || call.createdAt || "",
              cost: call.cost ?? 0,
              hasContent,
              preview,
              callSummary,
              satisfactionOverall: satisfaction?.overall ?? null,
              type: call.type || "",
              endedAt: call.endedAt || call.updatedAt || "",
              assistantName: assistantNames.get(call.assistantId) || call.assistant?.name || "",
              phoneNumberName: call.phoneNumber?.name || "",
            };
          });

          calls.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

          return new Response(JSON.stringify({ calls, truncated, days }), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...(truncated ? { "X-Data-Truncated": "true" } : {}),
            },
          });
        } catch (err) {
          console.error("[vapi-calls-list] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch voice calls" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
