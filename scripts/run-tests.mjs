import { spawn } from 'node:child_process';

const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const testSuites = [
  { name: 'Unit tests', script: 'test:unit' },
  { name: 'API integration tests', script: 'test:api' },
  { name: 'API contract tests', script: 'test:contract' },
  { name: 'Migration tests', script: 'test:migrations' },
  { name: 'Browser end-to-end tests', script: 'test:e2e' },
];

const results = [];

for (const testSuite of testSuites) {
  console.log(`\n=== ${testSuite.name} ===\n`);
  const result = await runTestSuite(testSuite);
  results.push(result);
}

const hasFailure = results.some((result) => !result.passed);
console.log('\n=== Test summary ===');
for (const result of results) {
  const status = result.passed ? 'PASS' : 'FAIL';
  const detail = result.detail.length === 0 ? '' : ` (${result.detail})`;
  console.log(`${status.padEnd(4)} ${result.name}${detail}`);
}
console.log(`\nOverall: ${hasFailure ? 'FAIL' : 'PASS'}`);

process.exitCode = hasFailure ? 1 : 0;

async function runTestSuite(testSuite) {
  return await new Promise((resolve) => {
    const child = spawn(packageManager, ['run', testSuite.script], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    child.once('error', (error) => {
      resolve({
        name: testSuite.name,
        passed: false,
        detail: error.message,
      });
    });
    child.once('close', (code, signal) => {
      const detail = signal === null ? `exit code ${code}` : `signal ${signal}`;
      resolve({
        name: testSuite.name,
        passed: code === 0,
        detail: code === 0 ? '' : detail,
      });
    });
  });
}
