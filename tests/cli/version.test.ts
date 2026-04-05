import { afterEach, describe, expect, test, vi } from "vitest";

const ORIGINAL_NPM_PACKAGE_VERSION = process.env.npm_package_version;
const ORIGINAL_OPEN_RESEARCH_PACKAGE_VERSION = process.env.OPEN_RESEARCH_PACKAGE_VERSION;

afterEach(() => {
  vi.resetModules();

  if (ORIGINAL_NPM_PACKAGE_VERSION === undefined) delete process.env.npm_package_version;
  else process.env.npm_package_version = ORIGINAL_NPM_PACKAGE_VERSION;

  if (ORIGINAL_OPEN_RESEARCH_PACKAGE_VERSION === undefined) {
    delete process.env.OPEN_RESEARCH_PACKAGE_VERSION;
  } else {
    process.env.OPEN_RESEARCH_PACKAGE_VERSION = ORIGINAL_OPEN_RESEARCH_PACKAGE_VERSION;
  }
});

describe("getPackageVersion", () => {
  test("prefers the build-time injected package version", async () => {
    process.env.OPEN_RESEARCH_PACKAGE_VERSION = "0.1.6";
    process.env.npm_package_version = "9.9.9";

    const { getPackageVersion } = await import("@/lib/cli/version");

    expect(getPackageVersion()).toBe("0.1.6");
  });

  test("falls back to npm's package version during development", async () => {
    delete process.env.OPEN_RESEARCH_PACKAGE_VERSION;
    process.env.npm_package_version = "0.1.6-dev";

    const { getPackageVersion } = await import("@/lib/cli/version");

    expect(getPackageVersion()).toBe("0.1.6-dev");
  });
});
