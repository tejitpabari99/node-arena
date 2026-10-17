/** True when CREDITS.md lists `src` as a row entry. Markdown links/backticks/plain entries all work; a longer filename never credits a shorter one. */
export function isCredited(src: string, credits: string): boolean {
  const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s\\x60(])${escaped}(?=$|[\\s\\x60)])`, 'm').test(credits);
}
