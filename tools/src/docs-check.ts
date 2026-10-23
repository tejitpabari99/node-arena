import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Diagnostic } from './output.js';

const pathDocs = ['README.md', 'tools/README.md', 'docs/CONTENT_GUIDE.md', 'docs/LEVELS_GUIDE.md', 'docs/CREDITS.md'];
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Explicit templates and shell/code expressions are not concrete repository paths. */
function isPath(text: string): boolean {
  if (/[\s<>=():|"'\\]/.test(text) || text.startsWith('-') || text.startsWith('$') || text.startsWith('@')) return false;
  return text.includes('/') || /^[\w.-]+\.(?:md|json|[cm]?tsx?|[cm]?js|sh|ya?ml|ogg|png|glb|txt)$/.test(text);
}
function expandBraces(text: string): string[] {
  const match = /\{([^{}]+)\}/.exec(text);
  if (!match) return [text];
  return match[1]!.split(',').flatMap(part => expandBraces(text.slice(0, match.index) + part + text.slice(match.index + match[0].length)));
}
/** Match filesystem segments; no shell expansion, dependencies, or network. */
function matchesPath(base: string, path: string): boolean {
  const segments = path.replace(/\/$/, '').split('/');
  const visit = (dir: string, index: number): boolean => {
    if (index === segments.length) return existsSync(dir);
    const part = segments[index]!;
    if (!part.includes('*') && !part.includes('?')) return visit(resolve(dir, part), index + 1);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
    const entries = readdirSync(dir, { withFileTypes: true });
    if (part === '**') return visit(dir, index + 1) || entries.some(entry => entry.isDirectory() && visit(resolve(dir, entry.name), index));
    const pattern = new RegExp(`^${escapeRegex(part).replaceAll('\\*', '.*').replaceAll('\\?', '.')}$`);
    return entries.some(entry => pattern.test(entry.name) && visit(resolve(dir, entry.name), index + 1));
  };
  return visit(base, 0);
}
function markdownFiles(root: string, prefix = ''): string[] {
  return readdirSync(resolve(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'test-results', 'playwright-report'].includes(entry.name)
      || path === 'docs/agent_files' || /^docs\/research\/tower-wars\/06a/.test(path)) return [];
    if (entry.isDirectory()) return markdownFiles(root, path);
    return entry.isFile() && path.endsWith('.md') ? [path] : [];
  });
}

export async function checkDocs(root: string): Promise<{ errors: Diagnostic[]; summary: string }> {
  const errors: Diagnostic[] = [];
  const docs = new Map<string, string>();
  for (const file of new Set([...markdownFiles(root), ...pathDocs, 'AGENTS.md'])) {
    try { docs.set(file, await readFile(resolve(root, file), 'utf8')); }
    catch { errors.push({ file, pointer: '', message: 'Required documentation file is missing.' }); }
  }
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  const commandDocs = `${docs.get('tools/README.md') ?? ''}\n${docs.get('AGENTS.md') ?? ''}`;
  for (const script of Object.keys(pkg.scripts ?? {})) {
    const token = escapeRegex(script);
    // Exact code tokens support script tables; pnpm invocations also work in shell fences.
    const mentioned = new RegExp('`' + token + '(?:\\s+[^`\\n]*)?`').test(commandDocs)
      || new RegExp(`\\bpnpm\\s+(?:run\\s+)?${token}(?=[\\s\x60]|$)`, 'm').test(commandDocs);
    if (!mentioned) errors.push({ file: 'package.json', pointer: `/scripts/${script}`, message: `Root script ${script} is undocumented; mention its command in tools/README.md or AGENTS.md.` });
  }
  for (const file of pathDocs) {
    const text = docs.get(file) ?? '';
    // A single inline code span on one line, never fenced code blocks.
    let fenced = false;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;
      for (const [, code] of line.matchAll(/(?<!`)`([^`]+)`(?!`)/g)) {
        const path = code!;
        if (!isPath(path)) continue;
        const missing = expandBraces(path).filter(expanded => !matchesPath(root, expanded) && !matchesPath(resolve(root, dirname(file)), expanded));
        if (missing.length) errors.push({ file, pointer: `line ${index + 1}`, message: `Repository path ${path} does not exist (missing: ${missing.join(', ')}; checked root and document directory).` });
      }
    }
  }
  // Documentation only: detector literals in source/test fixtures are deliberately outside this scan.
  const obsolete = /\bbots:churn\b|\bbalance-targets(?:[\w.-]*)|\bslice:verify\b|\bvisual:[\w:*-]*|\btools\/layout(?:[\w/.-]*)|(?:\bpnpm\s+(?:run\s+)?|`|\]\((?:[^\n)]*\/)?)layout(?=[\s`)/.]|$)/g;
  for (const [file, text] of docs) {
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      for (const match of line.matchAll(obsolete)) errors.push({ file, pointer: `line ${index + 1}`, message: `Obsolete gate reference: ${match[0]}.` });
    }
  }
  return { errors, summary: `Checked ${Object.keys(pkg.scripts ?? {}).length} root scripts, paths in ${pathDocs.length} documents, and obsolete references in ${docs.size} Markdown files; ${errors.length} drift issue(s).` };
}
