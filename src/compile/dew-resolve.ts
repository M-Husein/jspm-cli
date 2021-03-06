/*
 *   Copyright 2014-2019 Guy Bedford (http://guybedford.com)
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */
import * as path from 'path';
import { validPkgNameRegEx } from '../utils/common';
import { ProcessedPackageConfig } from '../install/package';
import { builtins } from '@jspm/resolve';

export function relativeResolve (require: string, filePath: string, pkgBasePath: string, files: Record<string, boolean>, main: string, folderMains: Record<string, string>, localMaps: Record<string, boolean>, deps: Record<string, boolean>, name: string) {
  const fileDir = path.resolve(filePath, '..');

  if (require === '.')
    require += '/';
  const internalResolution = require.startsWith('./') || require.startsWith('../');
  
  if (!internalResolution) {
    if (require.startsWith('/') || !getMatch(require, deps) && !builtins[require])
      return null;
    return toDewPlain(require.endsWith('/') ? require.substr(0, require.length - 1) : require);
  }

  // jspm-resolve internal resolution handling
  const resolved = path.resolve(fileDir, require);
  if (!resolved.startsWith(pkgBasePath) || resolved.length !== pkgBasePath.length && resolved[pkgBasePath.length] !== path.sep)
    return toDew(require);

  // attempt to file resolve resolved
  let pkgPath = resolved.substr(pkgBasePath.length + 1).replace(/\\/g, '/');

  if (pkgPath === '')
    pkgPath = main || pkgPath;

  const resolvedPkgPath = resolveFile(pkgPath, files) || resolveDir(pkgPath, files, folderMains);

  // local maps need to be "plain" to support package maps
  if (localMaps[resolvedPkgPath || pkgPath])
    return toDew(name + '/' + (resolvedPkgPath || pkgPath));

  // local resolved that doesn't exist -> not found
  if (!resolvedPkgPath)
    return null;

  let relPath = path.relative(fileDir, path.resolve(pkgBasePath, resolvedPkgPath)).replace(/\\/g, '/');
  if (relPath === '')
    relPath = './' + resolvedPkgPath.substr(resolvedPkgPath.lastIndexOf('/') + 1);
  else if (!relPath.startsWith('../'))
    relPath = './' + relPath;
  return toDew(relPath);
}

export function resolveFile (name: string, files: Record<string, boolean>) {
  if (Object.hasOwnProperty.call(files, name))
    return name;
  if (Object.hasOwnProperty.call(files, name + '.js'))
    return name + '.js';
  if (Object.hasOwnProperty.call(files, name + '.json'))
    return name + '.json';
  if (Object.hasOwnProperty.call(files, name + '.node'))
    return name + '.node';
}

export function resolveDir (name: string, files: Record<string, boolean>, folderMains: Record<string, string>) {
  if (Object.hasOwnProperty.call(folderMains, name))
    return resolveFile(name + '/' + folderMains[name], files);
}

export function toDewPlain (path: string): string {
  // do not convert node builtins to dew
  if (path === '@empty')
    return '@empty.dew';
  const pkgNameMatch = path.match(validPkgNameRegEx);
  // if it is a package path, add dew
  if (!pkgNameMatch)
    return toDew(path);
  // if its an exact valid package name then it is a main
  // unless it is a builtin
  if (builtins[path])
      return path;
  return path + '/index.dew.js';
}

export function toDew (path: string) {
  if (path.endsWith('.js'))
    return path.substr(0, path.length - 3) + '.dew.js';
  if (path.endsWith('.node'))
    return path;
  return path + '.dew.js';
}

export function pcfgToDeps (pcfg: ProcessedPackageConfig, optional = false) {
  const deps: Record<string, boolean> = {};
  if (pcfg.dependencies)
    Object.keys(pcfg.dependencies).forEach(key => deps[key] = true);
  if (pcfg.peerDependencies)
    Object.keys(pcfg.peerDependencies).forEach(key => deps[key] = true);
  if (optional && pcfg.optionalDependencies)
    Object.keys(pcfg.optionalDependencies).forEach(key => deps[key] = true);
  return deps;
}

export function isESM (resolved: string, deps?: Record<string, boolean>) {
  return resolved.endsWith('.node') || builtins[resolved] && !(deps && deps[resolved]);
}

export function getMatch (path: string, matchObj: Record<string, any>): string {
  let sepIndex = path.length;
  do {
    const segment = path.slice(0, sepIndex);
    if (segment in matchObj)
      return segment;
  } while ((sepIndex = path.lastIndexOf('/', sepIndex - 1)) !== -1)
}