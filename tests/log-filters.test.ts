// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  LogFilterBar,
  filterScopeForPath,
  setLogFilters,
  useLogFilters,
} from "../src/components/collections/LogFilters";

function Probe({ scope }: { scope: string }) {
  const [f, set] = useLogFilters(scope);
  return createElement(
    "button",
    { "data-testid": scope, onClick: () => set({ status: "reached" }) },
    f.status,
  );
}
beforeEach(() => sessionStorage.clear());
afterEach(() => cleanup());

describe("filters stay on their own page", () => {
  it("a status chosen on Voice does not reach SMS", () => {
    render(
      createElement(
        "div",
        null,
        createElement(Probe, { scope: "voice" }),
        createElement(Probe, { scope: "sms" }),
      ),
    );
    act(() => screen.getByTestId("voice").click());
    expect(screen.getByTestId("voice").textContent).toBe("reached");
    expect(screen.getByTestId("sms").textContent).toBe("all");
  });
  it("the assistant's filters land on the page it opens", () => {
    expect(filterScopeForPath("/")).toBe("overview");
    expect(filterScopeForPath("/sms?x=1")).toBe("sms");
    expect(filterScopeForPath("/clients/ABC")).toBe("clients");
    setLogFilters("/queue", { q: "acme" });
    expect(JSON.parse(sessionStorage.getItem("rgf-log-filters:queue")!).q).toBe("acme");
    expect(sessionStorage.getItem("rgf-log-filters:clients")).toBeNull();
  });
  it("a status that is not one of the page's options is reset to All (it no longer filters invisibly)", () => {
    const onChange = vi.fn();
    render(
      createElement(LogFilterBar, {
        filters: { q: "", status: "reached", range: "all", source: "all" },
        onChange,
        onClear: () => {},
        shown: 0,
        total: 10,
      }),
    );
    expect(onChange).toHaveBeenCalledWith({ status: "all" });
  });
});
