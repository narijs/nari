import { promises as fs } from 'fs';
import path from 'path';
import { PassThrough, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import zlib from 'zlib';

import { CACHE_DIR, atomicFileWrite, isPathExists } from '../cache';
import { get } from '../net';

const minimizeMetadata = (metaJson: any) => {
  for (const key of Object.keys(metaJson)) {
    if (['name', 'version', 'dist-tags', 'versions', 'time'].indexOf(key) < 0) {
      delete metaJson[key];
    }
  }

  for (const versionJson of Object.values<any>(metaJson.versions)) {
    for (const key of Object.keys(versionJson)) {
      if (
        [
          'name',
          'version',
          'license',
          'engines',
          'dist',
          'exports',
          'scripts',
          'bin',
          'dependencies',
          'peerDependencies',
          'optionalDependencies',
          'peerDependenciesMeta',
          'os',
          'cpu',
          'libc',
        ].indexOf(key) < 0
      ) {
        delete versionJson[key];
      }
    }
    for (const key of Object.keys(versionJson['dist'])) {
      if (['tarball', 'integrity'].indexOf(key) < 0) {
        delete versionJson['dist'][key];
      }
    }
    for (const key of Object.keys(versionJson['scripts'] || {})) {
      if (
        ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare'].indexOf(key) < 0
      ) {
        delete versionJson['scripts'][key];
      }
    }
    if (Object.keys(versionJson['scripts'] || {}).length === 0) {
      delete versionJson['scripts'];
    }
  }
  metaJson['_nariRefVer'] = 1;
};

const getMetadataCacheFilePath = (name: string): string => {
  const filename = `${name.replaceAll('/', '-')}.tjson`;
  const filePath = path.join(CACHE_DIR, 'metadata', filename);
  return filePath;
};

type CachedMetadata = { metaJson: any; cacheMeta: any };

export const getCachedMetadata = async (name: string): Promise<CachedMetadata | null> => {
  const filePath = getMetadataCacheFilePath(name);

  const isFileCached = await isPathExists(filePath);

  let metaJson, jsonList;
  if (isFileCached) {
    const contents = await fs.readFile(filePath, 'utf8');
    jsonList = contents.split('\n');
    const cacheMeta = JSON.parse(jsonList[0]);
    cacheMeta.date = new Date(cacheMeta.date);
    metaJson = JSON.parse(jsonList[1]);
    return { metaJson, cacheMeta };
  } else {
    return null;
  }
};

export const downloadMetadata = async (name: string, cachedMetadata?: CachedMetadata | null): Promise<any> => {
  const headers = { 'Accept-Encoding': 'gzip' };

  if (cachedMetadata) {
    headers['if-none-match'] = cachedMetadata.cacheMeta.etag;
  }

  try {
    const response = await get(`https://registry.npmjs.org/${name}`, { headers });

    const unzip = response.headers['content-encoding'] === 'gzip' ? zlib.createGunzip() : new PassThrough();
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

    const data = Buffer.concat(chunks);

    let metaJson;
    if (response.statusCode === 304) {
      metaJson = cachedMetadata!.metaJson;
      // console.log(`metadata cache hit for ${name}, cf status: ${response.headers.get('cf-cache-status')}`);
    } else if (response.statusCode === 200) {
      const etag = response.headers['etag'];
      const date = response.headers['date'];
      const cachedFilePath = getMetadataCacheFilePath(name);
      if (cachedMetadata) {
        console.log(`metadata for ${name} changed, old etag: ${cachedMetadata.cacheMeta.etag}, new etag: ${etag}`);
        await fs.rm(cachedFilePath, { force: true });
      }

      metaJson = JSON.parse(data.toString('utf-8'));
      minimizeMetadata(metaJson);

      await atomicFileWrite(cachedFilePath, `${JSON.stringify({ etag, date })}\n${JSON.stringify(metaJson)}`);
    } else {
      throw new Error(`the registry replied with status: ${response.statusCode}: ${data.toString('utf-8')}`);
    }

    return metaJson;
  } catch (e: any) {
    e.message = `While fetching https://registry.npmjs.org/${name}: ${e.message}`;
    throw e;
  }
};
