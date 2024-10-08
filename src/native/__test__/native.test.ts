import path from 'path';
import os from 'os';
import fs from 'fs';
import { readFile } from 'fs/promises';
import tar from 'tar-stream';
// import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { TOOL_NAME } from '../../constants';

import native from '..';

describe('native bindings', () => {
  it('should support creating a tarball', async () => {
    let tmpDir;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), TOOL_NAME));

      const pack = tar.pack();
      pack.entry({ name: 'package/dir/foo.txt', mode: 0o755 }, 'foo contents');
      pack.entry({ name: 'package/dir/bar.txt' }, 'bar contents');
      pack.finalize();

      const tarballPath = path.join(tmpDir, 'foo.tar.gz');

      // await pipeline(pack, zlib.createGzip(), fs.createWriteStream(tarballPath));
      await pipeline(pack, fs.createWriteStream(tarballPath));

      const entries = native.unpackTarball(tmpDir, await readFile(tarballPath));

      const fooPath = path.join(tmpDir, 'dir', 'foo.txt');
      expect(fs.readFileSync(fooPath, 'utf8')).toEqual('foo contents');
      expect(!!(fs.statSync(fooPath).mode & fs.constants.S_IXUSR)).toBeTruthy();
      expect(entries).toEqual([
        { location: 'dir/foo.txt', mode: 493 },
        { location: 'dir/bar.txt', mode: 436 },
      ]);
    } finally {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true });
      }
    }
  });
});
