// Copies the contract SDL (bandadau-docs is the source of truth) into ./schema. Usage: pnpm schema:sync [--check]
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '../../../bandadau-docs/contracts/graphql/admin.graphql');
const target = join(root, 'schema/admin.graphql');

if (!existsSync(source)) {
  console.error(`contract not found: ${source}`);
  process.exit(1);
}
if (process.argv.includes('--check')) {
  const same = readFileSync(source, 'utf8') === readFileSync(target, 'utf8');
  console.log(same ? 'schema/admin.graphql matches the contract' : 'schema/admin.graphql DIFFERS from the contract (run pnpm schema:sync)');
  process.exit(same ? 0 : 1);
}
copyFileSync(source, target);
console.log('schema/admin.graphql updated from the contract');
