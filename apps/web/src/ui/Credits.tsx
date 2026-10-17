import creditsMarkdown from "../../../../docs/CREDITS.md?raw";
export interface CreditEntry { title: string; author: string; licence: string; url: string }
/** Rows of the CREDITS.md asset table (File | Pack | Author | URL | Licence | ...), grouped by pack. */
export function parseCredits(markdown: string): CreditEntry[] {
  const seen = new Map<string, CreditEntry>();
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5 || !/^(models|audio)\//.test(cells[0]!)) continue;
    const entry = { title: cells[1]!.replace(/\s*\(.*$/, ""), author: cells[2]!, url: cells[3]!, licence: cells[4]!.replace(/\s*\(.*$/, "") };
    seen.set(`${entry.title}|${entry.author}|${entry.url}`, entry);
  }
  return [...seen.values()];
}
export const credits = parseCredits(creditsMarkdown);
export function Credits({ entries = credits, onBack }: { entries?: readonly CreditEntry[]; onBack: () => void }) {
  return (
    <section class="panel credits">
      <h2>Credits</h2>
      <ul class="credit-list">
        {entries.map((entry) => (
          <li key={entry.title + entry.url}>
            <strong>{entry.title}</strong>
            <span>{entry.author} · {entry.licence}</span>
            <a href={entry.url} target="_blank" rel="noopener noreferrer">{entry.url}</a>
          </li>
        ))}
      </ul>
      <button onClick={onBack}>Back to menu</button>
    </section>
  );
}
