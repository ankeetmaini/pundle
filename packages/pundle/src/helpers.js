/* @flow */
/* eslint-disable global-require, no-underscore-dangle */

import Path from 'path'
import invariant from 'assert'
import PundleFS from 'pundle-fs'
import promisify from 'sb-promisify'
import { getRelativeFilePath } from 'pundle-api'
import type { PundleConfig, Loadable, Loaded } from '../types'

const resolveModule = promisify(require('resolve'))

export async function resolve<T>(request: string, rootDirectory: string): Promise<T> {
  let resolved
  try {
    resolved = await resolveModule(request, { basedir: rootDirectory })
  } catch (_) {
    const error = new Error(`Unable to resolve '${request}' from root directory`)
    error.code = 'MODULE_NOT_FOUND'
    // $FlowIgnore: Custom property
    error.duringResolution = true
    throw error
  }
  // $FlowIgnore: This is how it works, loadables are dynamic requires
  let mainModule = require(resolved)
  mainModule = mainModule && mainModule.__esModule ? mainModule.default : mainModule
  if (typeof mainModule === 'object' && mainModule) {
    return mainModule
  }
  throw new Error(`Module '${request}' (at '${getRelativeFilePath(resolved, rootDirectory)}') exported incorrectly`)
}

// NOTE:
// In all configs but rootDirectory, given config takes precendece
export async function getPundleConfig(rootDirectory: string, a: Object): Promise<PundleConfig> {
  const config = {}

  let b = {}
  if (typeof a !== 'object' || !a) {
    throw new Error('Config must be an object')
  }
  if (typeof a.enableConfigFile === 'undefined' || a.enableConfigFile) {
    let configModule
    try {
      configModule = await resolve(Path.join(rootDirectory, a.configFileName || '.pundle.js'), rootDirectory)
    } catch (error) {
      if (!error.duringResolution) {
        throw error
      }
    }
    if (typeof configModule === 'function') {
      b = await configModule()
    } else if (typeof configModule === 'object') {
      b = configModule
    }
    if (!b) {
      throw new Error(`Invalid export value of config file in '${rootDirectory}'`)
    }
  }

  // NOTE: This copies all even non-standard stuff from Pundle config file to
  // The config. This will allow any third party consumers to be able to define
  // custom stuff and then use it. For example, the API package uses this
  // to support output configurations
  Object.assign(config, b)

  config.watcher = {}
  if (b.watcher) {
    invariant(typeof b.watcher === 'object', 'config.watcher must be an Object')
    Object.assign(config.watcher, b.watcher)
  }
  if (a.watcher) {
    invariant(typeof a.watcher === 'object', 'config.watcher must be an Object')
    Object.assign(config.watcher, a.watcher)
  }
  config.presets = []
  if (a.presets) {
    invariant(Array.isArray(a.presets), 'config.presets must be an Array')
    config.presets = config.presets.concat(a.presets)
  }
  if (b.presets) {
    invariant(Array.isArray(b.presets), 'config.presets must be an Array')
    config.presets = config.presets.concat(b.presets)
  }
  config.components = []
  if (a.components) {
    invariant(Array.isArray(a.components), 'config.components must be an Array')
    config.components = config.components.concat(a.components)
  }
  if (b.components) {
    invariant(Array.isArray(b.components), 'config.components must be an Array')
    config.components = config.components.concat(b.components)
  }

  const compilation = {}
  compilation.debug = !!(a.debug || b.debug)
  compilation.entry = []
  if (!a.entry && !b.entry) {
    throw new Error('config.entry should be an Array or string')
  }
  if (a.entry) {
    invariant(typeof a.entry === 'string' || Array.isArray(a.entry), 'config.entry must be an Array or string')
    compilation.entry = compilation.entry.concat(a.entry)
  }
  if (b.entry) {
    invariant(typeof b.entry === 'string' || Array.isArray(b.entry), 'config.entry must be an Array or string')
    compilation.entry = compilation.entry.concat(b.entry)
  }
  compilation.fileSystem = Object.assign({}, PundleFS)
  if (b.fileSystem) {
    invariant(typeof b.fileSystem === 'object', 'config.fileSystem must be an Object')
    Object.assign(compilation.fileSystem, b.fileSystem)
  }
  if (a.fileSystem) {
    invariant(typeof a.fileSystem === 'object', 'config.fileSystem must be an Object')
    Object.assign(compilation.fileSystem, a.fileSystem)
  }
  if (!a.rootDirectory && !b.rootDirectory) {
    throw new Error('config.rootDirectory must be a string')
  }
  if (a.rootDirectory) {
    invariant(a.rootDirectory, 'config.rootDirectory must be a string')
    compilation.rootDirectory = a.rootDirectory
  }
  if (b.rootDirectory) {
    invariant(b.rootDirectory, 'config.rootDirectory must be a string')
    compilation.rootDirectory = b.rootDirectory
  }
  compilation.replaceVariables = Object.assign({}, {
    'process.env.NODE_ENV': config.debug ? '"development"' : '"production"',
  }, config.replaceVariables)
  if (b.replaceVariables) {
    invariant(typeof b.replaceVariables === 'object', 'config.replaceVariables must be an Object')
    Object.assign(compilation.replaceVariables, b.replaceVariables)
  }
  if (a.replaceVariables) {
    invariant(typeof a.replaceVariables === 'object', 'config.replaceVariables must be an Object')
    Object.assign(compilation.replaceVariables, a.replaceVariables)
  }

  config.compilation = compilation
  return config
}

export async function getLoadables<T>(loadables: Array<Loadable<T>>, rootDirectory: string): Promise<Array<Loaded<T>>> {
  const toReturn = []
  for (let i = 0, length = loadables.length; i < length; i++) {
    const entry = loadables[i]

    let config = {}
    let component
    if (Array.isArray(entry)) {
      [component, config] = entry
    } else {
      component = entry
    }
    const resolved = typeof component === 'string' ? await resolve(component, rootDirectory) : component
    if (!resolved || typeof resolved.$type !== 'string') {
      throw new Error('Unable to load invalid component')
    }
    toReturn.push([resolved, config])
  }
  return toReturn
}
