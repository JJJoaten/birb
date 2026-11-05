#!/usr/bin/env node
'use strict';
// One-off helper: swaps the YOURUSER placeholder for your GitHub username everywhere.
//   node scripts/set-repo.js your-github-username
const fs = require('fs');
const path = require('path');

const user = process.argv[2];
if (!user || !/^[A-Za-z0-9-]+$/.test(user)) {
  console.error('Usage: node scripts/set-repo.js <your-github-username>');
  process.exit(1);
}
const root = path.join(__dirname, '..');
const files = ['package.json', 'main.js', 'README.md', 'docs/index.html'];
let total = 0;
for (const f of files) {
  const p = path.join(root, f);
  const before = fs.readFileSync(p, 'utf8');
  const n = (before.match(/YOURUSER/g) || []).length;
  if (n) fs.writeFileSync(p, before.replace(/YOURUSER/g, user));
  console.log(f.padEnd(18), n ? n + ' replaced' : 'nothing to change');
  total += n;
}
console.log(total ? `\nDone. The repository should be named "birb" (github.com/${user}/birb).` : '\nAlready set up.');
