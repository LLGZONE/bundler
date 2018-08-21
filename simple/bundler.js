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
    this.entryFiles = [entryFilePath];
    this.assetGraph = new Map();
    this.processQueue = [];
    this.babelConfig = {
      presets: [
        [
          '@babel/env',
          {
            targets: { node: 'current' }
          }
        ]
      ]
    };
  }

  async bundle(fileName) {
    await this.init();
    await this.createGraph(this.entryFiles[0]);
    await this.packageAssets(fileName);
    console.log(chalk.green('success'));
  }

  async init() {
    const babelConfigPath = await findUp('.babelrc');
    if (babelConfigPath) {
      this.babelConfig = JSON.parse(await readFile(babelConfigPath));
    }
  }

  async createAsset(filePath) {
    console.log(filePath);
    const fileContent = await readFile(filePath, 'utf8');
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
    const { code } = babel.transformFromAst(ast, null, {
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
      await Promise.all(
        asset.deps.map(async dep => {
          const depPath = resolve.sync(dep, {
            basedir: dir
          });
          const depAsset =
            this.assetGraph.get(depPath) || (await this.createAsset(depPath));
          depMap[dep] = depAsset.id;
          this.processQueue.push(depAsset);
        })
      );
      asset.depMap = depMap;
    }
  }

  async packageAssets(fileName) {
    let modules = '';
    this.assetGraph.forEach(asset => {
      modules += `'${asset.id}':[
        function(require, module, exports) {
          ${asset.code}
        },
        ${JSON.stringify(asset.depMap)},
      ],`;
    });
    const result = `(function(modules, entry) {
      function require(id) {
        const [fn, mapping] = modules[id]
        function localRequire(name) {
          return require(mapping[name])
        }
        const module = { exports: {} }
        fn(localRequire, module, module.exports)
        return module.exports
      }
      for (let i = 0; i < entry.length; i++) {
        require(entry[i])
      }
    })({${modules}}, ${JSON.stringify(this.entryFiles)})`;
    const dir = path.dirname(fileName) || 'dist';
    let file = 'bundle.js';
    if (path.extname(fileName) === '.js') file = path.basename(fileName);
    await mkdirp(dir);
    await writeFile(path.join(dir, file), result);
  }
}

export default Bundler;
