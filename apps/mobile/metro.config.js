const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Monorepo: vigilar todo el workspace para que cambios en packages/* recarguen.
config.watchFolders = [workspaceRoot];

// Buscar paquetes en node_modules de la app y del workspace.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Importante para pnpm: NO desactivar el hierarchical lookup. Las deps
// transitivas de pnpm viven en node_modules/.pnpm/{pkg}/node_modules como
// symlinks, y Metro tiene que poder escalar el árbol para encontrarlas.

module.exports = withNativeWind(config, { input: './global.css' });
