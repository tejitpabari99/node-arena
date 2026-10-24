// TW_EXTRACT handling: the extract is an external input (CI has none), so tools exit 2 with a one-line message.
import { join } from 'node:path';

export const TEXTASSET_DIR = join('assets', 'defaultlocalgroup_assets', 'TextAsset');
export const REMOTE_CONFIG_FILE = join('assets', 'data_unity3d', 'TextAsset', 'saykit_mlltrna_1.29.3_98@resourcesassets.json');

export const NO_EXTRACT_MESSAGE = 'TW_EXTRACT is not set: point it at the Tower War extract directory (the one containing assets/ and converted/).';

/** The extract root, or null when `TW_EXTRACT` is unset/empty. */
export function twExtractRoot(env: Record<string, string | undefined> = process.env): string | null {
  const v = env['TW_EXTRACT'];
  return v === undefined || v.trim() === '' ? null : v;
}

/** Extract root, or write a one-line message to stderr and exit 2. `exit` is injectable for tests. */
export function requireTwExtract(
  env: Record<string, string | undefined> = process.env,
  exit: (code: number) => never = (code) => process.exit(code),
  write: (line: string) => void = (line) => { process.stderr.write(line); },
): string {
  const root = twExtractRoot(env);
  if (root === null) {
    write(`${NO_EXTRACT_MESSAGE}\n`);
    return exit(2);
  }
  return root;
}
