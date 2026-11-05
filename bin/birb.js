#!/usr/bin/env node
'use strict';
// The `birb` command: opens files in the Birb app from a terminal.
//   birb notes.txt data.csv      open files (new names are created on first Save)
//   some-command | birb -        open piped text in a new tab
//   birb                         just open the app
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pkg = require('../package.json');
const args = process.argv.slice(2);

if (args.includes('-h') || args.includes('--help')) {
  console.log(`birb ${pkg.version}

Usage:
  birb [file ...]          open files in Birb
  command | birb -         open piped text in a new tab
  birb --version           print the version

Birb is found automatically if it is installed. To point at a specific copy,
set BIRB_APP to the full path of the Birb executable.`);
  process.exit(0);
}
if (args.includes('-v') || args.includes('--version')) { console.log(pkg.version); process.exit(0); }

function findApp() {
  const exists = p => { try { return p && fs.statSync(p).isFile(); } catch (e) { return false; } };
  if (exists(process.env.BIRB_APP)) return { cmd: process.env.BIRB_APP, pre: [] };

  // running from a source checkout (npm install && npm link)
  try {
    const electron = require('electron');
    if (typeof electron === 'string' && exists(electron)) return { cmd: electron, pre: [path.join(__dirname, '..')] };
  } catch (e) { /* electron is not installed here */ }

  const home = os.homedir();
  const candidates = {
    darwin: ['/Applications/Birb.app/Contents/MacOS/Birb', path.join(home, 'Applications/Birb.app/Contents/MacOS/Birb')],
    win32: [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Birb', 'Birb.exe'),
      path.join(process.env.ProgramFiles || '', 'Birb', 'Birb.exe')
    ],
    linux: ['/opt/Birb/birb', path.join(home, '.local/share/birb/birb')]
  }[process.platform] || [];
  const hit = candidates.find(exists);
  return hit ? { cmd: hit, pre: [] } : null;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

(async () => {
  const app = findApp();
  if (!app) {
    console.error('birb: could not find the Birb app. Install it from the releases page, or set BIRB_APP.');
    process.exit(1);
  }
  const out = [];
  for (const a of args) {
    if (a === '-') {
      if (process.stdin.isTTY) { console.error('birb: "-" reads piped text, e.g.  echo hello | birb -'); process.exit(1); }
      const text = await readStdin();
      const tmp = path.join(os.tmpdir(), `birb-stdin-${process.pid}-${Date.now()}.txt`);
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      out.push('--stdin=' + tmp);
    } else if (a.startsWith('-')) {
      continue;
    } else {
      out.push(path.resolve(a));
    }
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;     // set by some editors, would stop Electron starting as an app
  const child = spawn(app.cmd, [...app.pre, ...out], { detached: true, stdio: 'ignore', env });
  child.on('error', e => { console.error('birb: could not start Birb: ' + e.message); process.exit(1); });
  child.unref();
})();
