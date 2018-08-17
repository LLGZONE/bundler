require('babel-register');
const Bundler = require('./bundler').default;
const program = require('commander');

program
  .command('simple-bundler [entryFile]')
  .option('-t, --target <filepath>', 'the target file path')
  .action(function(entryFile, options) {
    const bundler = new Bundler(entryFile);
    bundler.bundle(options.target);
  })
  .parse(process.argv);
