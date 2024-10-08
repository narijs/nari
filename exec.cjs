const https = require('node:https');
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream, existsSync } = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const tar = require('tar-stream');
const { PassThrough, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawnSync } = require('node:child_process');

const TARGET_NODE_VERSION = 'v22.9.0';

const args = process.argv.slice(0);
let isWin = false;
for (let idx = 0; idx < args.length; idx++) {
  if (args[idx].indexOf('windows') >= 0) {
    isWin = true;
  }
}

const downloadFile = async (filePath, url) => {
  console.log(`Downloading ${url} to ${filePath}`);
  const urlParts = new URL(url);
  return new Promise((resolve, reject) =>
    https
      .get(
        {
          host: urlParts.host,
          path: urlParts.pathname + urlParts.search,
        },
        (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            downloadFile(filePath, res.headers.location).then(resolve, reject);
          } else if (res.statusCode !== 200) {
            throw new Error(`Error downloading ${url}, status: ${res.statusCode}`);
          } else {
            const file = createWriteStream(filePath);
            res
              .on('data', (chunk) => {
                file.write(chunk);
              })
              .on('error', (err) => {
                reject(err);
              })
              .on('end', () => file.end());
            file.on('finish', resolve);
          }
        },
      )
      .on('error', reject),
  ).catch((err) => {
    fs.unlinkSync(filePath);
    throw err;
  });
};

const unpackTarball = async (dirPath, buffer) => {
  const extract = tar.extract();

  const passthrough = new PassThrough();

  extract.on('entry', (header, stream, next) => {
    const relativeEntryPath = header.name.substring(header.name.indexOf('/') + 1);
    const entryPath = path.join(dirPath, relativeEntryPath);

    if (header.type === 'file') {
      (async () => {
        await fs.mkdir(path.dirname(entryPath), { recursive: true });

        await pipeline(stream, createWriteStream(entryPath));

        next();
      })();
    } else {
      next();
    }
  });

  passthrough.end(buffer);

  await pipeline(passthrough, extract);
};

const exec = async () => {
  await fs.mkdir('lib', { recursive: true });
  const versionPath = `node_modules/.cache/napi/${TARGET_NODE_VERSION}`;
  if (!existsSync(versionPath)) {
    await fs.rm(path.dirname(versionPath), { recursive: true, force: true });
    await fs.mkdir(path.dirname(versionPath), { recursive: true });
    await fs.writeFile(versionPath, '');
  }

  const headersPath = `node_modules/.cache/node-${TARGET_NODE_VERSION}-headers.tar.gz`;
  if (!existsSync(headersPath)) {
    await fs.mkdir(path.dirname(headersPath), { recursive: true });
    await downloadFile(
      headersPath,
      `https://nodejs.org/download/release/${TARGET_NODE_VERSION}/node-${TARGET_NODE_VERSION}-headers.tar.gz`,
    );
  }

  if (!existsSync(`node_modules/.cache/napi/include/node`)) {
    console.log(`Unpacking ${headersPath}`);

    const unzip = zlib.createGunzip();
    const chunks = [];

    await pipeline(
      createReadStream(headersPath),
      unzip,
      new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      }),
    );

    const buffer = Buffer.concat(chunks);

    await unpackTarball(`node_modules/.cache/napi`, buffer);
  }

  if (isWin) {
    const winLibPath = `node_modules/.cache/napi/node.lib`;
    if (!existsSync(winLibPath)) {
      await fs.mkdir(path.dirname(winLibPath), { recursive: true });
      await downloadFile(winLibPath, `https://nodejs.org/download/release/${TARGET_NODE_VERSION}/win-x64/node.lib`);
    }
  }

  const result = spawnSync(args[2], args.slice(3), { stdio: 'inherit' });
  process.exit(result.status);
};

exec();
