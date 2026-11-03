import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import type { Diagnostic } from './output.js';

const maintainedFolders = ['concepts', 'implementation', 'reference', 'decisions', 'testing', 'specs', 'operations', 'contracts'];
const requiredDocs = ['README.md', 'tools/README.md', 'AGENTS.md', 'docs/README.md',
  'docs/specs/game-rules.md', 'docs/implementation/content-authoring.md', 'docs/implementation/owner-art.md',
  'docs/implementation/level-import.md', 'docs/reference/level-coverage.md', 'docs/reference/credits.md',
  'docs/operations/pvp-server.md', 'docs/decisions/futures.md'];
const historicalDocumentation = (file: string): boolean => /^docs\/(?:agent_files|research|img)(?:\/|$)/.test(file);
const checksInlinePaths = (file: string): boolean => /^(?:README\.md|tools\/README\.md|docs\/(?:implementation|reference|operations|testing)\/.*\.md)$/.test(file);
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

/** New navigation gates apply to maintained docs, not frozen evidence or branch records. */
function documentationFolders(root: string, prefix = 'docs'): string[] {
  if (!existsSync(resolve(root, prefix))) return [];
  return [prefix, ...readdirSync(resolve(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = `${prefix}/${entry.name}`;
    return entry.isDirectory() && !entry.name.startsWith('.') && !historicalDocumentation(path) ? documentationFolders(root, path) : [];
  })];
}

/** Preserve line numbers while excluding fenced examples, including longer outer fences. */
function proseLines(text: string): { text: string; line: number }[] {
  const lines: { text: string; line: number }[] = [];
  let fence: { marker: string; length: number } | undefined;
  const visible = text.replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\n]/g, ' '));
  for (const [index, line] of visible.split(/\r?\n/).entries()) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (match && match[1]![0] === fence.marker && match[1]!.length >= fence.length && !match[2]!.trim()) fence = undefined;
      continue;
    }
    if (match) { fence = { marker: match[1]![0]!, length: match[1]!.length }; continue; }
    lines.push({ text: line, line: index + 1 });
  }
  return lines;
}

/** Inline destinations only; reference links and autolinks are outside this gate's contract. */
function inlineLinks(line: string): string[] {
  const text = line.replace(/(`+).*?\1/g, '');
  const pattern = /!?\[(?:\\.|[^\]\\])*\]\(\s*(<[^>\n]*>|(?:\\.|[^()\s\\]|\([^()\n]*\))+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  return [...text.matchAll(pattern)].map(match => {
    const target = match[1]!;
    return (target.startsWith('<') ? target.slice(1, -1) : target).replace(/\\([^\p{L}\p{N}])/gu, '$1');
  });
}

type LocalLink = { file: string; anchor: string } | { error: string };
function localLink(root: string, file: string, target: string): LocalLink | undefined {
  // URL schemes, protocol-relative URLs and site-root URLs are not relative repository links.
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(target)) return undefined;
  const hash = target.indexOf('#');
  const rawPath = (hash < 0 ? target : target.slice(0, hash)).split('?')[0]!;
  let path: string; let anchor: string;
  try { path = decodeURIComponent(rawPath); anchor = decodeURIComponent(hash < 0 ? '' : target.slice(hash + 1)); }
  catch { return { error: `Invalid URL encoding in Markdown link ${target}.` }; }
  const destination = path ? resolve(root, dirname(file), path) : resolve(root, file);
  const repoPath = relative(root, destination).split(sep).join('/');
  if (repoPath === '..' || repoPath.startsWith('../')) return { error: `Relative Markdown link ${target} leaves the repository.` };
  return { file: repoPath, anchor };
}

/** GitHub-style heading slugs, with collision suffixes shared by all headings in a file. */
function headingAnchors(text: string): Set<string> {
  const anchors = new Set<string>();
  let previous = '';
  for (const { text: line } of proseLines(text)) {
    const atx = /^ {0,3}#{1,6}(?:[ \t]+|$)(.*?)(?:[ \t]+#+[ \t]*)?$/.exec(line);
    const heading = atx ? atx[1]! : /^ {0,3}(?:=+|-+)\s*$/.test(line) ? previous : undefined;
    previous = line.trim();
    if (heading === undefined || !heading.trim()) continue;
    const plain = heading.replace(/(^|[\s(])(_{1,2})([^\n]+?)\2(?=$|[\s).,!?:;])/g, '$1$3').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#(x[\da-f]+|\d+);/gi, (_, value: string) => {
        const point = value.toLowerCase().startsWith('x') ? parseInt(value.slice(1), 16) : Number(value);
        return point <= 0x10ffff ? String.fromCodePoint(point) : '';
      });
    const base = plain.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\-\s]/gu, '').replace(/\s/g, '-');
    let slug = base; let suffix = 0;
    while (anchors.has(slug)) slug = `${base}-${++suffix}`;
    anchors.add(slug);
  }
  return anchors;
}

export async function checkDocs(root: string): Promise<{ errors: Diagnostic[]; summary: string }> {
  const errors: Diagnostic[] = [];
  const docs = new Map<string, string>();
  const folders = new Set(['docs', ...maintainedFolders.map(folder => `docs/${folder}`), ...documentationFolders(root)]);
  const indexes = [...folders].map(folder => `${folder}/README.md`);
  for (const file of new Set([...markdownFiles(root), ...requiredDocs, ...indexes])) {
    try { docs.set(file, await readFile(resolve(root, file), 'utf8')); }
    catch { errors.push({ file, pointer: '', message: indexes.includes(file) ? 'Folder index README.md is missing.' : 'Required documentation file is missing.' }); }
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
  const pathDocs = [...docs.keys()].filter(checksInlinePaths);
  for (const file of pathDocs) {
    const text = docs.get(file) ?? '';
    // A single inline code span on one line, never fenced code blocks.
    for (const { text: line, line: number } of proseLines(text)) {
      for (const [, code] of line.matchAll(/(?<!`)`([^`]+)`(?!`)/g)) {
        const path = code!;
        if (!isPath(path)) continue;
        const missing = expandBraces(path).filter(expanded => !matchesPath(root, expanded) && !matchesPath(resolve(root, dirname(file)), expanded));
        if (missing.length) errors.push({ file, pointer: `line ${number}`, message: `Repository path ${path} does not exist (missing: ${missing.join(', ')}; checked root and document directory).` });
      }
    }
  }
  const linkDocs = [...docs.keys()].filter(file => file === 'README.md' || file === 'tools/README.md' || (file.startsWith('docs/') && !historicalDocumentation(file)));
  const anchors = new Map<string, Set<string>>();
  for (const file of linkDocs) {
    for (const { text, line } of proseLines(docs.get(file)!)) {
      for (const target of inlineLinks(text)) {
        const link = localLink(root, file, target);
        if (!link) continue;
        const diagnostic = (message: string): void => { errors.push({ file, pointer: `line ${line}`, message }); };
        if ('error' in link) { diagnostic(link.error); continue; }
        const path = resolve(root, link.file);
        if (!existsSync(path)) { diagnostic(`Relative Markdown link target ${target} does not exist.`); continue; }
        if (!link.anchor) continue;
        const anchorFile = statSync(path).isDirectory() ? `${link.file}/README.md` : link.file;
        if (!anchorFile.toLowerCase().endsWith('.md')) continue;
        if (!anchors.has(anchorFile)) {
          try { anchors.set(anchorFile, headingAnchors(docs.get(anchorFile) ?? await readFile(resolve(root, anchorFile), 'utf8'))); }
          catch { diagnostic(`Cannot read Markdown anchor target ${target}.`); continue; }
        }
        if (!anchors.get(anchorFile)!.has(link.anchor)) diagnostic(`Markdown heading anchor #${link.anchor} does not exist in ${anchorFile} (link ${target}).`);
      }
    }
  }
  for (const folder of folders) {
    const index = `${folder}/README.md`;
    if (!docs.has(index)) continue;
    const listed = new Set(proseLines(docs.get(index)!).flatMap(({ text }) => inlineLinks(text)).flatMap(target => {
      const link = localLink(root, index, target);
      return link && 'file' in link ? [link.file] : [];
    }));
    for (const entry of readdirSync(resolve(root, folder), { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === 'README.md' || entry.name.startsWith('.')) continue;
      const sibling = `${folder}/${entry.name}`;
      if (!listed.has(sibling)) errors.push({ file: index, pointer: '', message: `Folder index must link sibling file ${entry.name}.` });
    }
  }
  // Documentation only: detector literals in source/test fixtures are deliberately outside this scan.
  const obsolete = /\bbots:churn\b|\bbalance-targets(?:[\w.-]*)|\bslice:verify\b|\bvisual:[\w:*-]*|\btools\/layout(?:[\w/.-]*)|(?:\bpnpm\s+(?:run\s+)?|`|\]\((?:[^\n)]*\/)?)layout(?=[\s`)/.]|$)/g;
  for (const [file, text] of docs) {
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      for (const match of line.matchAll(obsolete)) errors.push({ file, pointer: `line ${index + 1}`, message: `Obsolete gate reference: ${match[0]}.` });
    }
  }
  return { errors, summary: `Checked ${Object.keys(pkg.scripts ?? {}).length} root scripts, paths in ${pathDocs.length} documents, relative links in ${linkDocs.length} documents, ${folders.size} folder indexes, and obsolete references in ${docs.size} Markdown files; ${errors.length} drift issue(s).` };
}
