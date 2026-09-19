import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const engineDir = path.resolve('src/engine');
const files = fs.readdirSync(engineDir)
  .filter((name) => name.endsWith('.js'))
  .sort();

const failures = [];
for (const file of files) {
  try {
    await import(pathToFileURL(path.join(engineDir, file)).href);
  } catch (error) {
    failures.push({ file, error: error?.stack ?? String(error) });
  }
}

if (failures.length) {
  console.error(`Legacy engine compatibility check failed: ${failures.length}/${files.length} root modules failed.`);
  for (const failure of failures) {
    console.error(`\n--- ${failure.file} ---\n${failure.error}`);
  }
  process.exit(1);
}

console.log(`Legacy engine compatibility check passed: ${files.length} root-level engine modules imported successfully.`);
