import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, CircleAlert, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

// Single shared login. The form posts to /api/auth/login, which is handled in src/server.ts
// (it checks DASHBOARD_USER / DASHBOARD_PASSWORD and sets a signed session cookie).
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: search["error"] ? String(search["error"]) : undefined,
    next: typeof search["next"] === "string" ? (search["next"] as string) : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in | Rare Global Food Collections Hub" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { error, next } = Route.useSearch();
  const [passwordVisible, setPasswordVisible] = useState(false);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f2ee] px-4 py-6 sm:px-6 lg:p-8">
      <div className="grid w-full max-w-[1116px] overflow-hidden rounded-[26px] border border-[#f0d9d5] bg-white shadow-[0_24px_72px_rgba(97,8,13,0.2)] lg:min-h-[685px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="relative aspect-[827/895] min-w-0 overflow-hidden bg-[#870a12] lg:aspect-auto lg:min-h-full">
          <img
            src="/images/login-dashboard-panel.png"
            alt="Rare Global Food Collections dashboard overview with collection metrics and an overdue aging chart"
            className="absolute inset-0 h-full w-full object-contain"
          />
        </section>

        <section className="flex min-w-0 items-center justify-center bg-white px-6 py-9 sm:px-10 lg:items-start lg:px-[clamp(24px,4vw,60px)] lg:py-0">
          <div className="mt-0 w-full min-w-0 max-w-[560px] lg:mt-[clamp(46px,3.1vw,62px)]">
            <div className="flex items-center gap-3">
              <div className="flex h-[clamp(44px,2.92vw,56px)] w-[clamp(44px,2.92vw,56px)] items-center justify-center rounded-2xl bg-[#9d0d17] text-xl font-black text-[#fff1ef] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]">
                R
              </div>
              <div>
                <p className="text-[clamp(12px,0.83vw,16px)] font-black uppercase tracking-[0.12em] text-[#7b1a19]">
                  Rare Global Food
                </p>
                <p className="mt-0.5 text-[clamp(10px,0.68vw,13px)] font-semibold uppercase tracking-[0.22em] text-[#7f5e57]">
                  Trading Corporation
                </p>
              </div>
            </div>

            <div className="mt-8 lg:mt-[clamp(37px,2.55vw,49px)]">
              <h1 className="whitespace-nowrap text-[clamp(1.75rem,2.1vw,2.5rem)] font-bold leading-tight tracking-[-0.045em] text-[#2b2422]">
                Welcome Back
              </h1>
              <p className="mt-2 text-[clamp(14px,0.84vw,16px)] font-medium text-[#6b6463] lg:mt-[clamp(11px,0.98vw,19px)]">
                Sign in to the Accounting Collections Dashboard
              </p>
            </div>

            <form
              method="post"
              action="/api/auth/login"
              className="mt-7 space-y-5 lg:mt-[clamp(22px,2.55vw,49px)] lg:space-y-[clamp(15px,1.04vw,20px)]"
            >
              {error ? (
                <div
                  role="alert"
                  className="flex gap-2.5 rounded-xl border border-[#d7685d]/20 bg-[#f9d9d3] p-3 text-sm font-medium text-[#8a2d28]"
                >
                  <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Wrong login ID or password. Please try again.</span>
                </div>
              ) : null}

              <input type="hidden" name="next" value={next || "/"} />

              <label className="block">
                <span className="mb-2 block text-[clamp(14px,0.78vw,15px)] font-semibold text-[#292230] lg:mb-[clamp(6px,0.42vw,8px)]">
                  Company Email
                </span>
                <span className="relative block">
                  <Mail
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#6d655f]"
                    strokeWidth={1.8}
                  />
                  <input
                    name="username"
                    autoComplete="username"
                    required
                    autoFocus
                    placeholder="Enter your company email"
                    className="h-[54px] w-full rounded-[14px] border border-[#d9d1ca] bg-[#f7f2ee] pl-12 pr-3 text-[clamp(14px,0.78vw,15px)] text-[#241f1d] transition-all placeholder:text-[#7a716d] focus:border-[#a0262d] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#a0262d]/10 lg:h-[clamp(40px,2.7vw,52px)]"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-[clamp(14px,0.78vw,15px)] font-semibold text-[#292230] lg:mb-[clamp(6px,0.42vw,8px)]">
                  Password
                </span>
                <span className="relative block">
                  <LockKeyhole
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#6d655f]"
                    strokeWidth={1.8}
                  />
                  <input
                    name="password"
                    type={passwordVisible ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    placeholder="Enter your password"
                    className="h-[54px] w-full rounded-[14px] border border-[#d9d1ca] bg-[#f7f2ee] pl-12 pr-12 text-[clamp(14px,0.78vw,15px)] text-[#241f1d] transition-all placeholder:text-[#7a716d] focus:border-[#a0262d] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#a0262d]/10 lg:h-[clamp(40px,2.7vw,52px)]"
                  />
                  <button
                    type="button"
                    aria-label={passwordVisible ? "Hide password" : "Show password"}
                    aria-pressed={passwordVisible}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                    className="absolute right-3.5 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md text-[#533f38] transition hover:text-[#a0262d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a0262d]"
                  >
                    {passwordVisible ? (
                      <Eye className="h-5 w-5" strokeWidth={2} />
                    ) : (
                      <EyeOff className="h-5 w-5" strokeWidth={2} />
                    )}
                  </button>
                </span>
              </label>

              <div className="flex items-center justify-between gap-3 pt-1">
                <label className="flex items-center gap-2.5 text-[clamp(14px,0.78vw,15px)] text-[#40403f]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[#b9b0ac] bg-white accent-[#a0262d]"
                  />
                  <span>Remember me</span>
                </label>
                <a
                  href="#"
                  className="text-[clamp(14px,0.78vw,15px)] font-semibold text-[#a0262d] hover:underline"
                >
                  Forgot password?
                </a>
              </div>

              <button
                type="submit"
                className="group mt-2 flex h-[58px] w-full items-center justify-center gap-3 rounded-[14px] bg-[#9d0d17] px-4 text-[clamp(16px,0.94vw,18px)] font-bold text-[#fff8f6] shadow-[0_14px_30px_rgba(122,15,22,0.22)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a0262d]/20 lg:mt-[clamp(6px,0.52vw,10px)] lg:h-[clamp(46px,3.125vw,60px)]"
              >
                Sign In
                <ArrowRight
                  aria-hidden="true"
                  className="h-5 w-5 transition-transform group-hover:translate-x-1"
                />
              </button>
            </form>

            <div className="mt-7 flex items-start gap-3 border-t border-[#daced6] pt-4 text-[12px] leading-5 text-[#5e5757] lg:mt-[clamp(42px,2.86vw,55px)] lg:pt-[clamp(14px,1.04vw,20px)] lg:text-[clamp(12px,0.75vw,14px)] lg:leading-[clamp(17px,1.15vw,22px)]">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f4e2db] text-[#a0262d] lg:h-[clamp(20px,1.67vw,32px)] lg:w-[clamp(20px,1.67vw,32px)]">
                <ShieldCheck
                  className="h-3.5 w-3.5 lg:h-[clamp(13px,1.25vw,24px)] lg:w-[clamp(13px,1.25vw,24px)]"
                  strokeWidth={2.5}
                />
              </div>
              <p>
                Access is limited to Rare Global Food team members only. All activities are logged
                and secure.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
