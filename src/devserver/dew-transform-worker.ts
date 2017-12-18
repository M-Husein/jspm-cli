/*
 *   Copyright 2014-2017 Guy Bedford (http://guybedford.com)
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

const babel = require('babel-core');
const babylon = require('babylon');
const traverse = require('babel-traverse').default;
const t = require('babel-types');
const pluginEsdew = require('babel-plugin-transform-cjs-dew');
const visitCjsDeps = require('babel-visit-cjs-deps');

let curSource: string, curAst: any, curFilename: string, curProduction: boolean;

process.on('message', async ({ type, data }) => {
  switch (type) {
    case 'source':
      curSource = data.source;
      curFilename = data.filename;
      curProduction = data.production;
      curAst = undefined;
      process.send({ type: 'source', data: undefined });
      break;

    case 'analyze-esm':
      try {
        if (curAst === undefined)
          curAst = babylon.parse(curSource, {
            plugins: ['dynamicImport', 'importMeta', 'classProperties', 'optionalCatchBinding', 'objectRestSpread'],
            sourceType: 'module',
            sourceFilename: curFilename
          });
        const body = curAst.program.body;
        const deps = [];
        for (let i = 0; i < body.length; i++) {
          const node = body[i];
          let depIndex;
          if (node.source) {
            depIndex = deps.indexOf(node.source.value);
            if (depIndex === -1) {
              deps.push(node.source.value);
              depIndex = deps.length - 1;
            }
          }
        }
        // extract dynamic imports
        traverse(curAst, {
          enter (path) {
            if (path.type !== 'Import')
              return;
            let arg = path.parent.arguments[0];
            switch (arg.type) {
              case 'TemplateLiteral':
                if (arg.expressions.length === 0 && arg.quasis.length === 1) {
                  deps.push(arg.quasis[0].value.cooked);
                }
              break;
              case 'StringLiteral':
                deps.push(arg.value);
              break;
            }
          }
        });
        process.send({ type: 'deps', data: { deps } });
      }
      catch (err) {
        if (err instanceof SyntaxError && (<{ loc?: any }>err).loc)
          process.send({ type: 'syntax-error', data: { loc: (<{ loc?: any }>err).loc, msg: err.message } });
        else
          process.send({ type: 'error', data: err.stack });
      }
      break;

    case 'analyze-cjs':
      try {
        if (curAst === undefined)
          curAst = babylon.parse(curSource, {
            plugins: ['classProperties', 'optionalCatchBinding', 'objectRestSpread'],
            allowReturnOutsideFunction: true,
            sourceFilename: curFilename
          });
        // extract export specifiers
        const deps = [], resolves = [];
        traverse(curAst, visitCjsDeps({ deps, resolves }));

        for (let i = 0; i < deps.length; i++) {
          const dep = deps[i];
          if (resolves.indexOf(dep) === -1)
            resolves.push(dep);
        }

        process.send({ type: 'deps', data: data === false ? { deps } : { deps }});
      }
      catch (err) {
        if (err instanceof SyntaxError && (<{ loc?: any }>err).loc)
          process.send({ type: 'syntax-error', data: { loc: (<{ loc?: any }>err).loc, msg: err.message } });
        else
          process.send({ type: 'error', data: err.stack });
      }
      break;

    case 'transform-dew':
      try {
        if (curSource === undefined)
          throw new Error('Source not passed to worker.');
        if (curAst === undefined)
          curAst = babylon.parse(curSource, {
            plugins: ['classProperties', 'optionalCatchBinding', 'objectRestSpread'],
            allowReturnOutsideFunction: true,
            sourceFilename: curFilename
          });
        const resolveMap = data;
        const { code, map } = babel.transformFromAst(curAst, curSource, {
          compact: false,
          sourceMaps: true,
          sourceMapTarget: curFilename + '?dew',
          plugins: [[pluginEsdew, {
            filename: curFilename,
            define: {
              'process.env.NODE_ENV': curProduction ? '"production"' : '"development"'
            },
            resolve: typeof resolveMap === 'object' && (name => resolveMap[name] || name)
          }]]
        });
        map.sourcesContent = [curSource];
        curAst = undefined;
        curSource = undefined;
        process.send({ type: 'transform-dew', data: { source: code, sourceMap: JSON.stringify(map) } });
      }
      catch (err) {
        if (err instanceof SyntaxError && (<{ loc?: any }>err).loc)
          process.send({ type: 'syntax-error', data: { loc: (<{ loc?: any }>err).loc, msg: err.message } });
        else
          process.send({ type: 'error', data: err.stack });
      }
      break;

    case 'transform-esm':
      try {
        if (curSource === undefined)
          throw new Error('Source not passed to worker.');
        if (curAst === undefined)
          curAst = babylon.parse(curSource, {
            plugins: ['dynamicImport', 'importMeta', 'classProperties', 'optionalCatchBinding', 'objectRestSpread'],
            sourceType: 'module',
            sourceFilename: curFilename
          });
        const resolveMap = data;
        const { code, map } = babel.transformFromAst(curAst, curSource, {
          compact: false,
          sourceMaps: true,
          sourceMapTarget: curFilename,
          resolveModuleSource: typeof resolveMap === 'object' && (source => resolveMap[source] || source),
          plugins: [
            ({ types: t }) => ({
              visitor: {
                Import (path) {
                  let argPath = path.parentPath.get('arguments.0');
                  switch (argPath.node.type) {
                    case 'TemplateLiteral':
                      if (argPath.node.expressions.length === 0 && argPath.node.quasis.length === 1) {
                        const resolved = resolveMap[argPath.node.quasis[0].value.cooked];
                        if (resolved)
                          argPath.replaceWith(t.stringLiteral(resolved));
                      }
                    break;
                    case 'StringLiteral':
                      const resolved = resolveMap[argPath.node.value];
                      if (resolved)
                        argPath.replaceWith(t.stringLiteral(resolved));
                    break;
                  }
                }
              }
            })
          ]
        });
        map.sourcesContent = [curSource];
        curAst = undefined;
        curSource = undefined;
        process.send({ type: 'transform-esm', data: { source: code, sourceMap: JSON.stringify(map) } });
      }
      catch (err) {
        if (err instanceof SyntaxError && (<{ loc?: any }>err).loc)
          process.send({ type: 'syntax-error', data: { loc: (<{ loc?: any }>err).loc, msg: err.message } });
        else
          process.send({ type: 'error', data: err.stack });
      }
      break;
  }
});