const PACKAGE_VERSION =
  process.env.OPEN_RESEARCH_PACKAGE_VERSION ??
  process.env.npm_package_version ??
  "0.0.0";

export function getPackageVersion(): string {
  return PACKAGE_VERSION;
}
