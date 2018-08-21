#!/usr/bin/env node

require('@babel/register')({
  cwd: __dirname
});
const program = require('commander');
const Bundler = require('./bundler').default;

program
  .option('-f, --file <entryFile>', 'the entry file path')
  .option('-t, --target <filepath>', 'the target file path')
  .action(function(options) {
    const bundler = new Bundler(options.file);
    bundler.bundle(options.target).catch(err => console.error(err));
  })
  .parse(process.argv);
