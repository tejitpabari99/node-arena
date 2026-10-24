/** Parse the free balance command's plain text, tolerating update banners. */
export function parseBalance(stdout) {
  const match = /^\s*Available credits:\s*(\d+(?:\.\d+)?)\s*$/m.exec(stdout);
  const credits = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(credits)) throw new Error('Unable to parse available credits');
  return credits;
}
