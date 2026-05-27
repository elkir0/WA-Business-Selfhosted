#!/usr/bin/env node
/**
 * Interactive CLI to generate an admin password bcrypt hash.
 *
 * Usage:
 *   node scripts/set-password.js
 *
 * Prompts for a password (no echo), then prints:
 *
 *   ADMIN_PASSWORD_HASH=$2a$12$...
 *
 * Copy the line into your `.env`. The server reads it at boot.
 *
 * No third-party prompt library — uses Node's readline with stdin TTY tricks
 * to suppress echo, keeping the dependency footprint minimal.
 */

'use strict';

const readline = require('readline');
const bcrypt = require('bcryptjs');

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    // Print question manually so we can swallow input rendering.
    process.stdout.write(question);

    let answer = '';
    function handleData(buf) {
      const str = buf.toString('utf8');
      for (const ch of str) {
        const code = ch.charCodeAt(0);
        if (ch === '\n' || ch === '\r' || code === 4 /* Ctrl-D */) {
          process.stdout.write('\n');
          if (typeof stdin.setRawMode === 'function') stdin.setRawMode(!!wasRaw);
          stdin.removeListener('data', handleData);
          rl.close();
          resolve(answer);
          return;
        } else if (code === 3 /* Ctrl-C */) {
          process.stdout.write('\n');
          process.exit(130);
        } else if (code === 8 || code === 127 /* Backspace / DEL */) {
          if (answer.length > 0) answer = answer.slice(0, -1);
        } else {
          answer += ch;
        }
      }
    }

    if (typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true);
    } else {
      console.warn('\n[warn] stdin is not a TTY — your password will be echoed.');
    }
    stdin.resume();
    stdin.on('data', handleData);
  });
}

async function main() {
  console.log('WA-Business-Selfhosted — admin password setup');
  console.log('-------------------------------------------------');
  const pw1 = await promptHidden('New admin password: ');
  if (pw1.length < 8) {
    console.error('\nError: password must be at least 8 characters.');
    process.exit(2);
  }
  const pw2 = await promptHidden('Confirm: ');
  if (pw1 !== pw2) {
    console.error('\nError: passwords do not match.');
    process.exit(2);
  }
  const hash = await bcrypt.hash(pw1, 12);
  console.log('\nCopy the line below into your .env file:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
