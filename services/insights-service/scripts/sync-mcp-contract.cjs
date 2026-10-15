// Copies the normative MCP contract (bandadau-docs/contracts/mcp/tools.schema.json) next to the MCP server.
// Run after every contract change (contract-first); the contract test fails if both copies diverge.
const { copyFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const src = resolve(__dirname, '../../../../bandadau-docs/contracts/mcp/tools.schema.json');
const dst = resolve(__dirname, '../src/interface-adapters/controllers/mcp/tools.schema.json');
if (!existsSync(src)) {
  console.error(`contract not found: ${src}`);
  process.exit(1);
}
copyFileSync(src, dst);
console.log('synced', dst);
