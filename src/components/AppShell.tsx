import { Link } from "@tanstack/react-router";
import { useLiveCollections } from "@/hooks/useLiveCollections";
import { LiveIndicator } from "@/components/collections/LiveIndicator";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  ListChecks,
  FileBarChart,
  Phone,
  Mail,
  MessageCircle,
  Smartphone,
} from "lucide-react";

const nav = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/queue", label: "Reminder Queue", icon: ListChecks },
  { to: "/reports", label: "Reports", icon: FileBarChart },
] as const;

const inboxes = [
  { channel: "whatsapp", label: "WhatsApp", icon: MessageSquare },
  { channel: "viber", label: "Viber", icon: MessageCircle },
  { channel: "sms", label: "SMS", icon: Smartphone, to: "/sms" as const },
  { channel: "email", label: "Email", icon: Mail, to: "/email" as const },
  { channel: "voice", label: "Voice", icon: Phone, to: "/voice" as const },
] satisfies InboxItem[];

type InboxItem = {
  channel: string;
  label: string;
  icon: typeof Mail;
  to?: "/email" | "/sms" | "/voice";
};

function InboxLink({ item, className }: { item: InboxItem; className: string }) {
  const activeProps = { className: "bg-primary text-primary-foreground hover:bg-primary" };
  if ("to" in item) {
    return (
      <Link to={item.to} className={className} activeProps={activeProps}>
        <item.icon className="h-4 w-4" />
        {item.label}
      </Link>
    );
  }
  return (
    <Link
      to="/inbox/$channel"
      params={{ channel: item.channel }}
      className={className}
      activeProps={activeProps}
    >
      <item.icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}

const linkBase =
  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-ink-hover hover:text-ink-foreground";

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { status, lastEventAt } = useLiveCollections();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-ink px-4 py-5 lg:flex">
        <Link to="/" className="mb-8 flex items-center gap-3 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            R
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold tracking-wide text-ink-foreground">
              RARE GLOBAL FOOD
            </span>
            <span className="block text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Collections Hub
            </span>
          </span>
        </Link>

        <nav className="space-y-1">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className={linkBase}
              activeProps={{ className: "bg-primary text-primary-foreground hover:bg-primary" }}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        <p className="mt-7 mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
          Channel Inboxes
        </p>
        <nav className="space-y-1">
          {inboxes.map((item) => (
            <InboxLink key={item.channel} item={item} className={linkBase} />
          ))}
        </nav>

        <div className="mt-auto rounded-lg bg-ink-hover p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Automation
          </p>
          <p className="mt-1 text-xs text-ink-foreground">n8n webhook connected</p>
          <div className="mt-2">
            <LiveIndicator status={status} lastEventAt={lastEventAt} compact />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-background/85 px-5 py-4 backdrop-blur md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold md:text-2xl">{title}</h1>
              {subtitle ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <LiveIndicator status={status} lastEventAt={lastEventAt} />
              {actions}
            </div>
          </div>
          <nav className="mt-3 flex gap-1 overflow-x-auto lg:hidden">
            {[...nav].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground"
                activeProps={{ className: "bg-secondary text-secondary-foreground" }}
              >
                {item.label}
              </Link>
            ))}
            {inboxes.map((item) => (
              <InboxLink
                key={item.channel}
                item={item}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground"
              />
            ))}
          </nav>
        </header>
        <main className="flex-1 px-5 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
