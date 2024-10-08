let native: any;
if (process.arch === 'x64') {
  const platfrom = process.platform;
  if (['linux', 'darwin', 'win32'].indexOf(process.platform) >= 0) {
    // eslint-disable-next-line
    native = require(`${typeof jest === 'undefined' ? './' : ''}native-${platfrom}-x64.node`);
  }
}

export default native;
