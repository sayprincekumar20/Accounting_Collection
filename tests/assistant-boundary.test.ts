// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AssistantBoundary, ListBoundary } from "../src/components/assistant/AssistantBoundary";
import { CONVERSATIONS_KEY } from "../src/components/assistant/store-key";

let boom = true;
let seq = 0;
const Thrower = () => {
  if (boom) throw new TypeError("Cannot read properties of undefined (reading 'x') #" + ++seq);
  return createElement("p", null, "all good");
};
const fetchSpy = vi.fn(async () => new Response("{}"));

beforeEach(() => {
  boom = true;
  fetchSpy.mockClear();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("error containment", () => {
  it("a crash inside the assistant shows a small notice instead of taking the page down", () => {
    render(
      createElement(
        "div",
        null,
        createElement("p", null, "dashboard"),
        createElement(AssistantBoundary, null, createElement(Thrower)),
      ),
    );
    expect(screen.getByText("dashboard")).toBeTruthy(); // the rest of the page is still there
    expect(screen.getByRole("alert").textContent).toContain("The assistant stopped working");
    expect(screen.getByRole("alert").textContent).toContain(
      "TypeError: Cannot read properties of undefined",
    );
  });

  it("reports the exact error to the server (so it can be read afterwards)", () => {
    render(createElement(AssistantBoundary, null, createElement(Thrower)));
    const call = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes("/api/assistant/client-error"),
    );
    expect(call).toBeTruthy();
    const body = JSON.parse(String((call![1] as RequestInit).body));
    expect(body).toMatchObject({ where: "assistant", name: "TypeError" });
    expect(body.message).toContain("Cannot read properties");
  });

  it("'Restart' recovers once the problem is gone; 'Clear saved conversations' also empties the storage", () => {
    localStorage.setItem(CONVERSATIONS_KEY, '[{"bad":true}]');
    render(createElement(AssistantBoundary, null, createElement(Thrower)));
    boom = false;
    fireEvent.click(screen.getByRole("button", { name: "Clear saved conversations and restart" }));
    expect(localStorage.getItem(CONVERSATIONS_KEY)).toBeNull();
    expect(screen.getByText("all good")).toBeTruthy();
  });

  it("a list that cannot be displayed is contained inside the conversation, with a retry", () => {
    render(
      createElement(
        "div",
        null,
        createElement("p", null, "chat continues"),
        createElement(ListBoundary, null, createElement(Thrower)),
      ),
    );
    expect(screen.getByText("chat continues")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("This list could not be displayed");
    expect(screen.getByRole("alert").textContent).toContain("Nothing was sent");
    boom = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("all good")).toBeTruthy();
  });
});
