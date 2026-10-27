import { expect, it } from 'vitest';
import { ContentLoadError, type Catalog } from '@node-arena/content';
import { validateEditorDocument } from '../../../../tools/src/editor-validation.js';
import { blankDocument } from '../../src/editor/document.js';

it('a draft with every building deleted reports a friendly zero-building issue instead of the raw schema message', () => {
  for (const theme of ['green', 'snow']) for (const size of ['small', 'medium', 'large'] as const) {
    const doc = { ...blankDocument('na-blank-unit', theme, size), buildings: [] };
    try { validateEditorDocument({} as Catalog, doc, doc.id); expect.unreachable(); } catch (reason) {
      expect(reason).toBeInstanceOf(ContentLoadError);
      const issues = (reason as ContentLoadError).errors;
      expect(issues.map(issue => issue.message)).toContain('Add at least one building');
      expect(issues.some(issue => /fewer than 1/.test(issue.message))).toBe(false);
    }
  }
});
