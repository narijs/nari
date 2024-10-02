import { promises as fs } from 'fs';
import crypto from 'crypto';
import os from 'os';
import path from 'path';

import { TOOL_NAME, CACHE_VERSION, DOWNLOAD_DIR } from '../constants';

const dirCache = new Set<string>();
let isDownloadDirPrepared = false;

export const ensureDownloadDirExists = async (): Promise<void> => {
  if (isDownloadDirPrepared)
    return;

  const isExists = await isPathExists(DOWNLOAD_DIR);
  if (isExists) {
    const entries = await fs.readdir(DOWNLOAD_DIR);
    for (const entry of entries) {
      await fs.rm(path.join(DOWNLOAD_DIR, entry), { recursive: true });
    }
  } else {
    await cachedCreateDir(DOWNLOAD_DIR);
  }

  isDownloadDirPrepared = true;
};

export const isPathExists = async (entryPath: string) => fs
  .stat(entryPath)
  .then(() => true)
  .catch(() => false);

export const cachedCreateDir = async (dirPath: string) => {
  if (!dirCache.has(dirPath)) {
    await fs.mkdir(dirPath, { recursive: true });

    const parts = dirPath.split(path.sep);
    for (let idx = 1; idx <= parts.length; idx++) {
      let subPath = parts.slice(0, idx).join(path.sep);
      subPath = subPath === '' ? path.sep : subPath;
      dirCache.add(subPath);
    }
  }
}

const getCacheDir = () => {
  let cacheHome;
  if (process.platform === 'win32') {
    cacheHome = process.env.LOCALAPPDATA;
  } else if (process.env.XDG_CACHE_HOME) {
    cacheHome = process.env.XDG_CACHE_HOME;
  }

  if (!cacheHome) {
    cacheHome = path.join(os.homedir(), '.cache');
  }

  return path.join(cacheHome, TOOL_NAME, CACHE_VERSION);
};

let isCacheDirExists: boolean | null = null;

export const ensureCacheDirExists = async () => {
  if (isCacheDirExists === null) {
    isCacheDirExists = await fs
      .stat(path.join(CACHE_DIR, 'tarballs'))
      .then(() => true)
      .catch(() => false) && await fs
      .stat(path.join(CACHE_DIR, 'metadata'))
      .then(() => true)
      .catch(() => false);
  }

  if (isCacheDirExists === false) {
    await fs.mkdir(path.join(CACHE_DIR, 'tarballs'), { recursive: true });
    await fs.mkdir(path.join(CACHE_DIR, 'metadata'), { recursive: true });

    isCacheDirExists = true;
  }
};

export const CACHE_DIR = getCacheDir();

export const atomicFileWrite = async (filePath: string, content: string | Buffer) => {
  const tmpPath = path.join(path.dirname(filePath), `${crypto.randomBytes(16).toString(`hex`)}.tmp`);
  try {
    await fs.writeFile(tmpPath, content);
    try {
      await fs.link(tmpPath, filePath);
    } catch {
      // empty
    }
  } finally {
    await fs.unlink(tmpPath);
  }
}
