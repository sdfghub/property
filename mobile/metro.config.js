const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')
const sharedRoot = path.resolve(workspaceRoot, 'packages', 'shared')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [sharedRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.extraNodeModules = {
  '@shared': path.resolve(sharedRoot, 'src'),
}

module.exports = config
