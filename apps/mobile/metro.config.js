// Learn more: https://docs.expo.dev/guides/monorepo/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so edits in packages/domain hot-reload here.
config.watchFolders = [workspaceRoot];

// Resolve from the app first, then the hoisted workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// npm workspaces hoists most packages; without this Metro can resolve two copies
// of react and fail with an invalid-hook error that points nowhere useful.
config.resolver.disableHierarchicalLookup = true;

// Import .svg files as React components. The icon set is authored as real SVG files
// so it can be opened in any editor, and this is what lets the app consume them
// without a parallel hand-written copy of every glyph.
config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer');
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

module.exports = config;
