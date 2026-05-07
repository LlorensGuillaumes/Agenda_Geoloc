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

// Compatibilidad NodeNext + Metro: packages/shared y packages/db usan
// extensión .js en imports relativos para satisfacer NodeNext (el api los
// compila con tsc/NodeNext). Metro no resuelve .js -> .ts por defecto.
// Este resolver intercepta los imports relativos *.js y prueba .ts/.tsx
// antes de caer al default.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const base = moduleName.slice(0, -3);
    for (const ext of ['.ts', '.tsx']) {
      try {
        return context.resolveRequest(context, base + ext, platform);
      } catch {
        // probar siguiente extensión
      }
    }
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
