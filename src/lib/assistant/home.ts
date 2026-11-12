// AI assistant home screen: loads the live numbers (read-only). Each source is loaded on its own, so one
// failing table only blanks its own number instead of the whole screen.
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { loadApprovalItems } from "@/lib/approvals-data";
import {
  buildPriorities,
  manilaDay,
  openEscalations,
  openHealth,
  overdueAccounts,
  promisesDue,
  waitingApproval,
  type HomeClient,
} from "./home-calc";

type Row = Record<string, unknown>;
const T = {
  escalations: "ANfkZZDIrDuC4RjK",
  promises: "JyGFOqTqI3QXHJbb",
  health: "vu4Ar3YK7tj0VaKy",
};
const companyKey = (id: unknown) =>
  String(id ?? "")
    .split("___")[0]!
    .trim()
    .toLowerCase();

export async function loadAssistantHome() {
  const [apr, esc, prom, health] = await Promise.allSettled([
    loadApprovalItems(),
    fetchAllDataTableRows<Row>(T.escalations),
    fetchAllDataTableRows<Row>(T.promises),
    fetchAllDataTableRows<Row>(T.health),
  ]);
  const errors: string[] = [];
  const get = <V>(r: PromiseSettledResult<V>, name: string): V | null => {
    if (r.status === "fulfilled") return r.value;
    errors.push(name);
    console.error(`[assistant-home] ${name} failed:`, r.reason);
    return null;
  };
  const aprV = get(apr, "clients");
  const escV = get(esc, "escalations");
  const promV = get(prom, "promises");
  const healthV = get(health, "health");

  const items: HomeClient[] = (aprV?.items ?? []).map((i) => ({
    client_id: i.client_id,
    overdue: i.overdue,
    approved: i.approved,
    internal_account: i.internal_account,
    sales_team: i.sales_team,
    multibranch: i.multibranch,
    promise_until: i.promise_until,
    ar_handoff_until: i.ar_handoff_until,
  }));
  const today = manilaDay(new Date());
  const owing = new Set(items.map((i) => companyKey(i.client_id)));

  const escalations = openEscalations(escV ?? []);
  const promises = promisesDue(promV ?? [], owing, today);
  const wf = openHealth(healthV ?? []);
  const waiting = waitingApproval(items);

  return {
    generated_at: new Date().toISOString(),
    today,
    stats: {
      overdue_accounts: aprV ? overdueAccounts(items) : null,
      open_escalations: escV ? escalations.count : null,
      promises_due: promV && aprV ? promises.dueToday + promises.missed : null,
      workflow_issues: healthV ? wf.total : null,
    },
    detail: {
      escalations_by_type: escalations.byType,
      promises,
      waiting_approval: waiting,
      health: { urgent: wf.urgent, warning: wf.warning },
    },
    priorities: buildPriorities({
      escalations,
      promises,
      waitingApproval: waiting,
      health: wf,
    }),
    health_events: wf.events.slice(0, 8),
    errors,
  };
}
