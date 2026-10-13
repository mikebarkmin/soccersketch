#!/usr/bin/env node
// Dependency-free browser runner. Requires Node 22+ and Chromium on PATH.
import {spawn} from 'node:child_process';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const pipeIndex = process.argv.indexOf('--pipes');
const prefix = pipeIndex >= 0 ? process.argv[pipeIndex + 1] : null;
const profile = prefix ? null : await mkdtemp(join(tmpdir(), 'soccersketch-check-'));
const child = prefix ? null : spawn(process.env.CHROMIUM || 'chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--allow-file-access-from-files', '--remote-debugging-pipe', `--user-data-dir=${profile}`], {stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']});
const input = prefix ? createWriteStream(prefix + '.in') : child.stdio[3];
const output = prefix ? createReadStream(prefix + '.out') : child.stdio[4];
let counter = 0, buffer = '', sessionId, transportError;
const pending = new Map();
function failTransport(error) {
  transportError = error;
  for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(error); }
  pending.clear();
}
input.on('error', failTransport);
output.on('error', failTransport);
child?.on('error', failTransport);
child?.stderr.on('data', () => {});
output.on('data', chunk => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (message.id && pending.has(message.id)) {
      const {resolve, reject, timer} = pending.get(message.id);
      clearTimeout(timer);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
  }
});
function call(method, params = {}, session = sessionId) {
  if (transportError) return Promise.reject(transportError);
  const id = ++counter;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20000);
    pending.set(id, {resolve, reject, timer});
    input.write(JSON.stringify({id, method, params, ...(session ? {sessionId: session} : {})}) + '\0');
  });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const {targetId} = await call('Target.createTarget', {url: 'about:blank'}, null);
  ({sessionId} = await call('Target.attachToTarget', {targetId, flatten: true}, null));
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', {width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false});
  await call('Page.navigate', {url: new URL('./index.html', import.meta.url).href});
  let state;
  for (let attempt = 0; attempt < 100; attempt++) {
    await pause(400);
    const evaluated = await call('Runtime.evaluate', {expression: 'JSON.stringify({done:document.body?.dataset.testResult,result:document.getElementById("result")?.textContent,checks:[...document.querySelectorAll("#checks li")].map(x=>x.textContent)})', returnByValue: true});
    state = JSON.parse(evaluated.result.value);
    if (state.done) break;
  }
  for (const line of state?.checks || []) console.log(line);
  console.log(state?.result || 'Runner did not load');
  if (!state?.done) throw new Error('Browser checks did not complete.');
  if (state.done !== 'passed') process.exitCode = 1;
  const screenshot = await call('Page.captureScreenshot', {format: 'png'});
  const destination = join(tmpdir(), 'soccersketch-browser-checks.png');
  await writeFile(destination, Buffer.from(screenshot.data, 'base64'));
  console.log(`Screenshot: ${destination}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  try { await call('Browser.close', {}, null); } catch {}
  input.destroy(); output.destroy(); child?.kill();
  if (profile) await rm(profile, {recursive: true, force: true});
}
