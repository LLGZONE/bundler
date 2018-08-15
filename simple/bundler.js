import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import traverse from '@babel/traverse';
import resolve from 'resolve';
import { promisify } from 'util';
import * as babel from '@babel/core';
import mkdirpCb from 'mkdirp';
import findUp from 'find-up';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdirp = promisify(mkdirpCb);
const babyParser = require('@babel/parser');

class Bundler {
  constructor(entryFilePath) {
    this.entryFilePath = entryFilePath;
    this.assetGraph = new Map();
    this.processQueue = [];
  }

  async bundle(fileName) {
    await this.init();
    await this.createGraph();
    await this.packageAssets(fileName);
  }

  async init() {
    const babelConfigPath = await findUp('.babelrc');
    this.babelConfig = JSON.parse(await readFile(babelConfigPath));
  }

  async createAsset(filePath) {
    const fileContent = await readFile(filePath);
    const plugins = this.babelConfig.plugins || [];
    const presets = this.babelConfig.presets || [];
    const ast = babyParser.parse(fileContent, {
      sourceType: 'module',
      plugins
    });
    // 依赖的包的相对路径
    const deps = [];
    traverse(ast, {
      ImportDeclaration: ({ node }) => {
        deps.push(node.source.value);
      }
    });
    const code = babel.transformFromAst(ast, null, {
      plugins,
      presets
    });
    const asset = {
      id: filePath,
      filePath,
      code,
      deps
    };
    this.assetGraph.set(filePath, asset);
    return asset;
  }

  async createGraph(entryFile) {
    const mainAsset = await this.createAsset(entryFile);
    this.processQueue.push(mainAsset);
    // 建立依赖的包的相对路径与实际的asset之间的对应关系
    for (const asset of this.processQueue) {
      const depMap = {};
      const dir = path.dirname(asset.filePath);
      Promise.all(
        asset.deps.map(async dep => {
          const depPath = resolve.sync(dep, {
            basedir: dir
          });
          const depAsset =
            this.assetGraph.get(depPath) || (await this.createAsset());
          depMap[dep] = depAsset;
          this.processQueue.push(depAsset);
        })
      );
      asset.depMap = depMap;
    }
  }

  async packageAssets(fileName) {
    let modules = '';
    this.assetGraph.forEach(asset => {
      modules += `${asset.id}:[
        function(require, module, exports) {
          ${asset.code}
        }
      ],
      ${JSON.stringify(asset.depMap)}`;
    });
    const result = `(function(modules) {
      function require(id) {
        const [fn, mapping] = modules[id]
        function localRequire(name) {
          return mapping[name]
        }
        const module = { exports: {} }
        fn(localRquire, module, module.exports)
        return modules.exports
      }
      require(0)
    })(${modules})`;
    const dir = path.dirname(fileName) || 'dist';
    let file = 'bundle.js';
    if (path.extname(fileName) === '.js') file = path.basename(fileName);
    await mkdirp(dir);
    await writeFile(path.join(dir, file), result);
  }
}
