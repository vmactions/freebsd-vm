// Require child_process module
const { fork } = require('child_process');
// Working directory for subprocess of installer
const cwd = './path-where-to-run-npm-command';
// CLI path FROM cwd path! Pay attention
// here - path should be FROM your cwd directory
// to your locally installed npm module
const cli = '../node_modules/npm/bin/npm-cli.js';
// NPM arguments to run with
// If your working directory already contains
// package.json file, then just install it!
const args = ['install']; // Or, i.e ['audit', 'fix']

// Run installer
const installer = fork(cli, args, {
    silent: true,
    cwd: cwd
});

// Monitor your installer STDOUT and STDERR
installer.stdout.on('data', (data) => {
    console.log(data);
});
installer.stderr.on('data', (data) => {
    console.log(data);
});

// Do something on installer exit
installer.on('exit', (code) => {
    console.log(`Installer process finished with code ${code}`);
});