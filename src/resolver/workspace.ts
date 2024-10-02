import { promises as fs } from 'fs';
import mm from 'micromatch';
import path from 'path';

import { NODE_MODULES } from '../constants';

const IGNORED_WORKSPACE_DIRECTORIES = new Set(['.git', NODE_MODULES]);

export type PurePackage = {
  json: any;
  workspacePath?: string;
  workspaces?: PurePackage[];
};

export const readWorkspaceTree = async ({
  json,
  relativePath,
  directories,
}: {
  json: any;
  relativePath: string;
  directories?: string[];
}): Promise<PurePackage> => {
  const pkg: PurePackage = { json, workspacePath: relativePath };

  const workspaceConfig = Array.isArray(json.workspaces) ? { packages: json.workspaces } : json.workspaces;
  if (workspaceConfig?.packages?.length > 0) {
    if (!directories) {
      directories = await getProjectDirectories();
    }

    const matchedDirectories = mm(directories, workspaceConfig.packages);
    for (const dir of matchedDirectories) {
      try {
        const json = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
        const relativeDirectories: string[] = [];
        for (const subdir of directories) {
          const subdirRelativePath = path.relative(dir, subdir);
          if (subdirRelativePath !== '' && !subdirRelativePath.startsWith('.')) {
            relativeDirectories.push(subdirRelativePath);
          }
        }
        const workspace = await readWorkspaceTree({ json, relativePath: dir, directories: relativeDirectories });
        pkg.workspaces = pkg.workspaces || [];
        pkg.workspaces.push(workspace);
      } catch (e: any) {
        if (e?.code !== 'ENOENT') throw e;
      }
    }
  }

  return pkg;
};

const getProjectDirectories = async (): Promise<string[]> => {
  const directories: string[] = [];

  const addDirectory = async (baseDir: string) => {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORED_WORKSPACE_DIRECTORIES.has(entry.name)) {
        const dir = path.join(baseDir, entry.name);
        directories.push(dir);
        await addDirectory(dir);
      }
    }
  };

  await addDirectory('.');

  return directories;
};
