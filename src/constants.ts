import path from 'path';

export const TOOL_NAME = 'nari';
export const CACHE_VERSION = `v1`;
export const NODE_MODULES = 'node_modules';
export const DOT_BIN = '.bin';
export const DOWNLOAD_DIR = path.join(NODE_MODULES, `.${TOOL_NAME}`);
export const BUILD_SCRIPTS = ['preinstall', 'install', 'postinstall'];
export const DEPENDENCY_TYPES = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
