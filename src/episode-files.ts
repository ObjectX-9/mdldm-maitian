import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function existingEpisodeFiles(directory: string, names: readonly string[]) {
  const entries = names.length > 1
    ? await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) =>
      error.code === 'ENOENT' || error.code === 'ENOTDIR' ? [] : null)
    : null;
  const files = entries && new Map(entries.map(entry => [entry.name, entry]));
  const present = await Promise.all(names.map(async name => {
    const entry = files?.get(name);
    return !files || entry?.isSymbolicLink()
      ? access(path.join(directory, name)).then(() => true, () => false)
      : !!entry;
  }));
  return new Set(names.filter((_, index) => present[index]));
}
