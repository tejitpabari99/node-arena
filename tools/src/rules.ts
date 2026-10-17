import ts from 'typescript';
import { readText, LocatedError } from './files.js';
import { walkFiles } from './walk.js';
import type { Diagnostic } from './output.js';

/** Only actual Markdown headings define rules; fenced examples and references do not. */
function ruleIds(markdown: string): { active: Set<string>; known: Set<string> } {
  const active = new Set<string>(), known = new Set<string>();
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  let fence = '', current: { ids: string[]; depth: number; tombstone: boolean } | undefined;
  const finish = () => {
    if (current && !current.tombstone) for (const id of current.ids) active.add(id);
  };
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''; continue; }
    if (fence) continue;
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const depth = heading[1]!.length;
      if (current && depth <= current.depth) { finish(); current = undefined; }
      const id = /^`?(R-[A-Z]+-\d+)\b`?/.exec(heading[2]!);
      const ids = id ? [id[1]!] : [];
      if (ids.length) {
        finish();
        for (const id of ids) {
          if (known.has(id)) throw new Error(`Duplicate rule heading ${id}`);
          known.add(id);
        }
        current = { ids, depth, tombstone: /\btombstone\b/i.test(heading[2]!) };
      }
    } else if (current && /^\s*(?:\*\*?|_)?(?:status\s*:\s*)?tombstone\b/i.test(line)) current.tombstone = true;
  }
  finish(); return { active, known };
}
function testTitles(source: string, file: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const titles: string[] = [];
  function callPath(expression: ts.Expression): string[] {
    if (ts.isIdentifier(expression)) return [expression.text];
    if (ts.isPropertyAccessExpression(expression)) return [...callPath(expression.expression), expression.name.text];
    // Vitest's describe.skip.each(table)(title, callback) keeps suite modifiers
    // on the inner call; inspect them before visiting the outer callback.
    if (ts.isCallExpression(expression)) return callPath(expression.expression);
    return [];
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isTest = ts.isIdentifier(callee) ? ['test', 'it'].includes(callee.text) :
        ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && ['test', 'it'].includes(callee.expression.text) && ['only', 'serial', 'concurrent'].includes(callee.name.text);
      const title = node.arguments[0], options = node.arguments[1];
      const skipped = options && ts.isObjectLiteralExpression(options) && options.properties.some(property => ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && ['skip', 'todo'].includes(property.name.text) && property.initializer.kind !== ts.SyntaxKind.FalseKeyword);
      const path = callPath(callee);
      const suiteModifiers = path[0] === 'describe' ? path.slice(1) : path[0] === 'test' && path[1] === 'describe' ? path.slice(2) : undefined;
      const isSuite = suiteModifiers && suiteModifiers.every(modifier => ['only', 'skip', 'todo', 'fixme', 'serial', 'concurrent', 'parallel', 'each'].includes(modifier));
      if (isSuite && (skipped || suiteModifiers!.some(modifier => ['skip', 'todo', 'fixme'].includes(modifier)))) return;
      if (isTest && title && node.arguments.length >= 2 && !skipped) {
        if (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)) titles.push(title.text);
        else if (ts.isTemplateExpression(title)) titles.push([title.head.text, ...title.templateSpans.map(span => span.literal.text)].join('\n'));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); return titles;
}
export async function checkRules(rulesFile: string, packagesDir: string): Promise<{ summary: string; errors: Diagnostic[] }> {
  let rules: ReturnType<typeof ruleIds>;
  try { rules = ruleIds(await readText(rulesFile)); }
  catch (error) { throw new LocatedError(rulesFile, (error as Error).message); }
  if (!rules.known.size) throw new LocatedError(rulesFile, 'No rule headings found');
  const covered = new Set<string>(), errors: Diagnostic[] = [];
  const files = await walkFiles(packagesDir, file => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
  for (const file of files) for (const title of testTitles(await readText(file), file)) {
    for (const match of title.matchAll(/\bcovers\s+(R-[A-Z]+-\d+)\b/g)) {
      const id = match[1]!; covered.add(id);
      if (!rules.known.has(id)) errors.push({ file, pointer: '', message: `${id} is an unknown rule ID in a test title` });
    }
  }
  for (const id of [...rules.active].sort()) if (!covered.has(id)) errors.push({ file: rulesFile, pointer: '', message: `${id} is untested (missing a covers tag in a test title)` });
  return { summary: `${rules.active.size} active rules; ${[...rules.active].filter(id => covered.has(id)).length} covered; ${rules.known.size - rules.active.size} tombstones exempt.`, errors };
}
