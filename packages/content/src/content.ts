import { ContentLoadError, type ContentIssue } from './fixed-point.js';
import { buildCatalog, type Catalog, type CatalogOptions, type ContentFiles } from './catalog.js';
import { compileLevel, type CompiledLevel } from './compile.js';
import { loadLevel, type LoadedLevel } from './level.js';

export interface LoadedContent {
  catalog: Catalog;
  levels: Record<string, LoadedLevel>;
  compiled: Record<string, CompiledLevel>;
  warnings: ContentIssue[];
}

/** Everything at once (tools/tests): catalog, every level, campaign -> level refs. Throws one aggregated `ContentLoadError`. */
export function loadContent(files: ContentFiles, options: CatalogOptions = {}): LoadedContent {
  const built = buildCatalog(files, options);
  const issues = [...built.issues];
  const levels = Object.create(null) as Record<string, LoadedLevel>;
  const compiled = Object.create(null) as Record<string, CompiledLevel>;
  const warnings: ContentIssue[] = [];
  if (built.catalog) {
    for (const [file, source] of Object.entries(built.levelFiles)) {
      try {
        const loaded = loadLevel(built.catalog, source, file);
        levels[loaded.level.id] = loaded; warnings.push(...loaded.warnings);
        compiled[loaded.level.id] = compileLevel(built.catalog, loaded.level);
      } catch (e) {
        if (e instanceof ContentLoadError) issues.push(...e.errors); else throw e;
      }
    }
    for (const [cid, c] of Object.entries(built.catalog.campaigns)) {
      c.entries.forEach((e, i) => { if (!Object.hasOwn(levels, e.level)) issues.push({ file: `data/campaigns/${cid}.json`, pointer: `/entries/${i}/level`, message: `Unknown level "${e.level}"` }); });
    }
  }
  if (issues.length || !built.catalog) throw new ContentLoadError(issues);
  return { catalog: built.catalog, levels, compiled, warnings };
}
