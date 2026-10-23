export interface ModelRef { file: string; node?: string }
/** Parse `models/x.glb` or `models/x.glb#node` into file + optional node name. */
export function parseModelRef(ref: string): ModelRef {
  const i = ref.indexOf('#');
  if (i < 0) return { file: ref };
  const file = ref.slice(0, i), node = ref.slice(i + 1);
  if (!file || !node || node.includes('#')) throw new Error(`Invalid model ref "${ref}"`);
  return { file, node };
}
