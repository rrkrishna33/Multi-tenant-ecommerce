import { describe, it, expect, afterEach } from "vitest";
import { env, envOr } from "../src/lib/env";

const KEY = "CRACKERS_TEST_VAR";

afterEach(() => {
  delete process.env[KEY];
});

describe("env", () => {
  it("returns a set value", () => {
    process.env[KEY] = "value";
    expect(env(KEY)).toBe("value");
  });

  it("treats an empty variable as unset", () => {
    // `.env` files are full of `KEY=` lines for optional settings. Without
    // this, `process.env.KEY ?? fallback` takes the empty string -- which is
    // how `NEXT_DIST_DIR=` produced `distDir: ""` and broke the build on a
    // fresh VPS.
    process.env[KEY] = "";
    expect(env(KEY)).toBeUndefined();
  });

  it("treats a whitespace-only variable as unset", () => {
    process.env[KEY] = "   ";
    expect(env(KEY)).toBeUndefined();
  });

  it("trims a value edited over SSH", () => {
    process.env[KEY] = "  postgres://localhost/crackers  ";
    expect(env(KEY)).toBe("postgres://localhost/crackers");
  });

  it("returns undefined when the variable does not exist", () => {
    expect(env(KEY)).toBeUndefined();
  });
});

describe("envOr", () => {
  it("falls back for missing, empty and blank values alike", () => {
    expect(envOr(KEY, "fallback")).toBe("fallback");
    process.env[KEY] = "";
    expect(envOr(KEY, "fallback")).toBe("fallback");
    process.env[KEY] = "\t\n";
    expect(envOr(KEY, "fallback")).toBe("fallback");
  });

  it("prefers a real value", () => {
    process.env[KEY] = "real";
    expect(envOr(KEY, "fallback")).toBe("real");
  });
});
