import { promises as fs, createWriteStream, Dirent } from 'fs';
import constants from 'constants';
import path from 'path';
import { PassThrough, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import tar from 'tar-stream';
import zlib from 'zlib';

import { Graph } from '../hoister';
import { parseSpecifier } from '../resolver';
import { CACHE_DIR, cachedCreateDir, atomicFileWrite, isPathExists } from '../cache';
import { get } from '../net';
import {
  DirEntry,
  DirEntryType,
  InstallEventType,
  installScript,
  setBuildFailures,
  installStateDeserializer,
  installStateSerializer,
} from './installScript';
import { runCommand } from '../runCommand';
import { NODE_MODULES } from '../constants';

const INSTALL_STATE_PATH = path.join(NODE_MODULES, '.install-state.json');
const INSTALL_STATE_VERSION = '1';

type TarballEntry = { location: string; mode: number };
type TarballMap = Map<string, TarballEntry[]>;

const downloadTarball = async (name: string, version: string, tarballUrl: string): Promise<Buffer> => {
  if (!tarballUrl) {
    throw new Error(`tarball url is empty for ${name}@${version}`);
  }

  const response = await get(tarballUrl);
  if (response.statusCode !== 200) {
    throw new Error(
      `Received ${response.statusCode}: ${response.statusMessage} from the registry while downloading ${tarballUrl}`,
    );
  } else {
    const unzip = zlib.createGunzip();
    const chunks: Buffer[] = [];

    await pipeline(
      response,
      unzip,
      new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      }),
    );

    const body = Buffer.concat(chunks);

    if (body.length === 0) {
      throw new Error(`Received empty tarball from ${tarballUrl}, response status: ${response.statusCode}`);
    }

    await atomicFileWrite(getTarballCacheFilePath(name, version), body);

    return body;
  }
};

const unpackTarball = async (dirPath: string, buffer: Buffer): Promise<TarballEntry[]> => {
  const extract = tar.extract();

  const entries: TarballEntry[] = [];

  const passthrough = new PassThrough();

  extract.on('entry', (header, stream, next) => {
    const relativeEntryPath = header.name.substring(header.name.indexOf('/') + 1);
    const entryPath = path.join(dirPath, relativeEntryPath);

    if (header.type === 'file') {
      (async () => {
        await cachedCreateDir(path.dirname(entryPath));

        await pipeline(stream, createWriteStream(entryPath));

        if (header.mode & constants.S_IXUSR) {
          entries.push({ location: relativeEntryPath, mode: 0o755 });
          await fs.chmod(entryPath, 0o755);
        } else {
          entries.push({ location: relativeEntryPath, mode: 0o664 });
        }

        next();
      })();
    } else {
      next();
    }
  });

  passthrough.end(buffer);

  await pipeline(passthrough, extract);

  return entries;
};

const getTarballBaseName = (name: string, version: string): string => `${name.replaceAll('/', '+')}-${version}`;
const getTarballName = (name: string, version: string): string => `${getTarballBaseName(name, version)}.tar`;

const getTarballCacheFilePath = (name: string, version: string): string => {
  const filename = getTarballName(name, version);
  const filePath = path.join(CACHE_DIR, 'tarballs', filename);
  return filePath;
};

const getCachedTarball = async (name: string, version: string): Promise<Buffer | null> => {
  const filePath = getTarballCacheFilePath(name, version);

  const isFileCached = await isPathExists(filePath);

  if (isFileCached) {
    const buffer = await fs.readFile(filePath);

    if (buffer.length === 0) {
      throw new Error(`Empty tarball at ${filePath}`);
    }

    return buffer;
  } else {
    return null;
  }
};

const installBin = async ({
  bin,
  binSet,
  dirPath,
  binPath,
}: {
  bin: any;
  binSet: Set<string>;
  dirPath: string;
  binPath: string;
}) => {
  if (bin) {
    await cachedCreateDir(binPath);

    for (const [scriptName, scriptPath] of Object.entries<string>(bin)) {
      const dstPath = path.join(binPath, scriptName);
      if (binSet.has(dstPath)) continue;
      binSet.add(dstPath);

      const srcPath = path.join(dirPath, scriptPath);

      await fs.rm(dstPath, { force: true });
      await fs.chmod(srcPath, 0o755);
      await fs.symlink(path.relative(path.dirname(dstPath), srcPath), dstPath);
    }
  }
};

const installTask = async ({
  id,
  targetPath,
  tarballMap,
  tarballUrl,
  bin,
  binSet,
  binPath,
  skipUnpack,
}: {
  id: string;
  targetPath: string;
  tarballUrl: string;
  tarballMap: TarballMap;
  bin?: Record<string, string>;
  binSet: Set<string>;
  binPath: string;
  skipUnpack: string;
}) => {
  if (!skipUnpack) {
    const { name, range: version } = parseSpecifier(id);

    let buffer = await getCachedTarball(name, version);

    if (!buffer) {
      buffer = await downloadTarball(name, version, tarballUrl);
    }

    const entries = await unpackTarball(targetPath, buffer);
    tarballMap.set(id, entries);
  }

  await installBin({ bin, dirPath: targetPath, binSet, binPath });
  // console.log('install', nmPath);
};

const cloneTask = async ({
  id,
  sourcePath,
  targetPath,
  bin,
  binSet,
  tarballMap,
  binPath,
}: {
  id: string;
  sourcePath: string;
  targetPath: string;
  bin?: Record<string, string>;
  binSet: Set<string>;
  tarballMap: TarballMap;
  binPath: string;
}) => {
  const entries = tarballMap.get(id);
  if (!entries) {
    throw new Error(`No info of tarball entries for package ${id}`);
  }

  for (const entry of entries) {
    const srcPath = path.join(sourcePath, entry.location);
    const dstPath = path.join(targetPath, entry.location);

    await cachedCreateDir(path.dirname(dstPath));
    await fs.copyFile(srcPath, dstPath, constants.COPYFILE_FICLONE);
    if (entry.mode & constants.S_IXUSR) {
      await fs.chmod(dstPath, 0o755);
    }
  }

  await installBin({ bin, dirPath: targetPath, binSet, binPath });
};

const linkTask = async ({ sourcePath, targetPath }: { sourcePath: string; targetPath: string }) => {
  await cachedCreateDir(path.dirname(targetPath));
  await fs.symlink(path.relative(path.dirname(targetPath), sourcePath), targetPath);
  // console.log('link', dstPath, '->', srcPath);
};

const buildTask = async ({
  id,
  targetPath,
  isWorkspace,
  optional,
  buildScripts,
  buildFailures,
}: {
  id: string;
  targetPath: string;
  isWorkspace: boolean;
  optional?: boolean;
  buildScripts: Map<string, string>;
  buildFailures: Map<string, string>;
}) => {
  for (const [scriptName, script] of buildScripts) {
    const timeStart = Date.now();
    const { code, output } = await runCommand(targetPath, scriptName, script, [], true);
    const timeEnd = Date.now();
    if (isWorkspace || (!optional && code !== 0)) {
      const finalOutput = output.trimEnd();
      console.log(`┌─${id} -> ${scriptName} at ${targetPath}`);
      if (finalOutput.length > 0) {
        const lines = finalOutput.split('\n');
        for (const line of lines) {
          console.log(`│ ${line}`);
        }
      }
      console.log(`└───${code === 0 ? '' : ' failed with code: ' + code} ${timeEnd - timeStart}ms`);
    }

    if (code !== 0 && !optional) {
      buildFailures.set(targetPath, scriptName);
      break;
    }
  }
};

const getDirEntryType = (entry: Dirent): DirEntryType => {
  if (entry.isSymbolicLink()) {
    return DirEntryType.SYMLINK;
  } else if (entry.isDirectory()) {
    return DirEntryType.DIRECTORY;
  } else {
    return DirEntryType.FILE;
  }
};

const deleteDir = async ({ targetPath, cleanOnly }: { targetPath: string; cleanOnly: boolean }) => {
  if (!cleanOnly) {
    await fs.rm(targetPath, { force: true, recursive: true });
  } else {
    const entries = await fs.readdir(targetPath);
    for (const entry in entries) {
      if (entry === NODE_MODULES) continue;
      await fs.rm(path.join(targetPath, entry), { force: true, recursive: true });
    }
  }
};

export const write = async (graph: Graph) => {
  let prevState;
  let prevStateText;
  try {
    prevStateText = await fs.readFile(INSTALL_STATE_PATH, 'utf8');
    prevState = JSON.parse(prevStateText, installStateDeserializer);
  } catch {
    // empty
  }

  const script = installScript(graph, prevState);
  const installTasks = new Map<string, Promise<any>>();
  const buildTasks = new Map<string, Promise<any>>();
  const buildFailures = new Map<string, string>();
  const binSet = new Set<string>();
  const tarballMap: TarballMap = new Map();

  let next;
  let nextArg: DirEntry[] | undefined;

  try {
    do {
      next = script.next(nextArg);
      nextArg = undefined;

      if (next.done) break;

      const step = next.value;
      const { targetPath } = step;

      if (step.type === InstallEventType.READDIR) {
        let entries: Dirent[] = [];
        try {
          entries = await fs.readdir(targetPath, { withFileTypes: true });
        } catch {
          // empty
        }

        nextArg = entries.map((entry) => ({ name: entry.name, type: getDirEntryType(entry) }));
      } else if (step.type === InstallEventType.DELETE) {
        await deleteDir({ targetPath, cleanOnly: step.cleanOnly });
      }
      if (step.type === InstallEventType.INSTALL) {
        installTasks.set(
          targetPath,
          installTask({
            id: step.id,
            targetPath,
            tarballUrl: step.tarballUrl,
            tarballMap,
            binSet,
            bin: step.bin,
            binPath: step.binPath,
            skipUnpack: step.skipUnpack,
          }),
        );
      } else if (step.type === InstallEventType.CLONE) {
        const { sourcePath } = step;
        const installPromise = installTasks.get(sourcePath);
        if (!installPromise) {
          throw new Error('Assertion: nothing to clone');
        }
        installTasks.set(
          targetPath,
          installPromise.then(() =>
            cloneTask({
              id: step.id,
              sourcePath,
              targetPath,
              tarballMap,
              binSet,
              bin: step.bin,
              binPath: step.binPath,
            }),
          ),
        );
      } else if (step.type === InstallEventType.LINK) {
        installTasks.set(targetPath, linkTask({ sourcePath: step.sourcePath, targetPath }));
      } else if (step.type === InstallEventType.BUILD) {
        const waitTasks: Promise<any>[] = [];
        for (const waitPath of step.waitPaths) {
          const installPromise = installTasks.get(waitPath)!;
          waitTasks.push(installPromise);
          const buildPromise = buildTasks.get(waitPath);
          if (buildPromise) {
            waitTasks.push(buildPromise);
          }
        }

        buildTasks.set(
          targetPath,
          Promise.all(waitTasks).then(() =>
            buildTask({
              id: step.id,
              targetPath,
              optional: step.optional,
              isWorkspace: step.isWorkspace,
              buildScripts: step.buildScripts,
              buildFailures,
            }),
          ),
        );
      }
    } while (!next.done);
  } finally {
    await Promise.all(installTasks.values());
    await Promise.all(buildTasks.values());
  }

  if (next && next.value) {
    const installState = next.value;
    installState.version = INSTALL_STATE_VERSION;
    setBuildFailures(installState, buildFailures);

    await cachedCreateDir(NODE_MODULES);

    const newStateText = JSON.stringify(installState, installStateSerializer, 0);
    if (newStateText !== prevStateText) {
      if (prevStateText) console.log('install state changed');
      if (prevStateText) {
        await fs.writeFile(INSTALL_STATE_PATH + '.old', JSON.stringify(JSON.parse(prevStateText), null, 2));
        await fs.writeFile(INSTALL_STATE_PATH + '.new', JSON.stringify(JSON.parse(newStateText), null, 2));
      }
      await fs.writeFile(INSTALL_STATE_PATH, newStateText);
    }
  } else {
    console.log('deleted install state');
    await fs.rm(INSTALL_STATE_PATH, { force: true });
  }

  return buildFailures.size === 0 ? 0 : 1;
};
