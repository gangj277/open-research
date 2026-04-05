export function formatDateTime(value?: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleString();
}
