import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Chrome 157+ made scroll methods (scrollIntoView, scrollTo…) return a Promise. An effect or ref callback written
// as `() => something()` RETURNS that value, and React then calls it as a clean-up: "TypeError: l is not a function"
// (the AI assistant crash of Nov 13). Effects and ref callbacks must use a block body.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

describe("effects and ref callbacks never return a value by accident", () => {
  const src = files(join(process.cwd(), "src"));
  it("useEffect / useLayoutEffect use a block body", () => {
    const bad = src.flatMap((f) => {
      const t = readFileSync(f, "utf8");
      return [...t.matchAll(/use(?:Layout)?Effect\(\s*\(\)\s*=>\s*(?![\s{])/g)].map(
        (m) => `${f}:${t.slice(0, m.index).split("\n").length}`,
      );
    });
    expect(bad).toEqual([]);
  });
  it("ref callbacks use a block body", () => {
    const bad = src.flatMap((f) => {
      const t = readFileSync(f, "utf8");
      return [...t.matchAll(/ref=\{\(?\w+\)?\s*=>\s*(?![\s{])/g)].map(
        (m) => `${f}:${t.slice(0, m.index).split("\n").length}`,
      );
    });
    expect(bad).toEqual([]);
  });
});
