import { loadContent, type LoadedContent } from './content.js';
import type { CatalogOptions, ContentFiles } from './catalog.js';
import { ContentLoadError, type ContentIssue } from './fixed-point.js';

export interface ValidationResult { errors: ContentIssue[]; warnings: ContentIssue[]; content?: LoadedContent }

/** Non-throwing wrapper over `loadContent` for tooling: every issue is returned with file + JSON pointer. */
export function validateContent(files: ContentFiles, options: CatalogOptions = {}): ValidationResult {
  try {
    const content = loadContent(files, options);
    return { errors: [], warnings: content.warnings, content };
  } catch (error) {
    if (error instanceof ContentLoadError) return { errors: error.errors, warnings: [] };
    throw error;
  }
}
