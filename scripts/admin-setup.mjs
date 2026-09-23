import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { initializeAdminAccount, readAccount } from '../server/auth.mjs';

async function hiddenPrompt(label) {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Run admin:setup in an interactive terminal so the password can be entered privately.');
  stdout.write(label);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolvePrompt, reject) => {
    let value = '';
    const finish = error => {
      stdin.off('keypress', onKey);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error); else resolvePrompt(value);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('Setup cancelled.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = [...value].slice(0, -1).join(''); return; }
      if (text && !key.ctrl && !key.meta && !/\p{Cc}/u.test(text) && value.length < 256) value += text;
    };
    stdin.on('keypress', onKey);
  });
}

try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run admin:setup -- [--email owner@example.com] [--reset]\nPasswords are entered privately. CMS_DATA_DIR chooses the private storage directory.');
  } else {
    const dataDir = resolve(process.env.CMS_DATA_DIR || '.cms-data');
    if (await readAccount(dataDir) && !args.includes('--reset')) throw new Error('An administrator already exists. Use --reset explicitly to replace the credentials.');
    let email;
    const emailIndex = args.indexOf('--email');
    if (emailIndex !== -1) email = args[emailIndex + 1];
    else {
      const prompt = createInterface({ input: stdin, output: stdout });
      email = (await prompt.question('Administrator email: ')).trim();
      prompt.close();
    }
    const password = await hiddenPrompt('Password (at least 12 characters; input hidden): ');
    const confirmation = await hiddenPrompt('Confirm password: ');
    if (password !== confirmation) throw new Error('Passwords do not match. No account was changed.');
    const account = await initializeAdminAccount({ dataDir, email, password, reset: args.includes('--reset') });
    console.log(`Administrator ${account.email} is ready. Start the server and sign in at /admin.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
