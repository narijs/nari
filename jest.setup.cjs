const { spawnSync } = require('node:child_process');

module.exports = () => {
  if (process.arch === 'x64' && ['win32', 'darwin', 'linux'].indexOf(process.platform) >= 0) {
    const result = spawnSync('nari', [`build:${process.platform}`], { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`Zig returned exit code: ${result.status}`);
    }
  }
};
