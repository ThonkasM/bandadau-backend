/** Clean Architecture dependency rule: source code dependencies point inwards only. `pnpm arch` (also part of `pnpm build`). */
const FRAMEWORK_PACKAGES = '^(@nestjs|@bandada|mongodb|zod|helmet|express|rxjs|reflect-metadata|@aws-sdk|amqplib|amqp-connection-manager)';

module.exports = {
  forbidden: [
    {
      name: 'entities-are-pure',
      comment: 'entities only depend on entities',
      severity: 'error',
      from: { path: '^src/entities' },
      to: { pathNot: '^src/entities' },
    },
    {
      name: 'use-cases-inward-only',
      comment: 'use-cases depend on entities and use-cases only',
      severity: 'error',
      from: { path: '^src/use-cases' },
      to: { path: '^src/(interface-adapters|frameworks-drivers)' },
    },
    {
      name: 'no-frameworks-in-core',
      comment: 'entities and use-cases never import frameworks, drivers or @bandada/* packages',
      severity: 'error',
      from: { path: '^src/(entities|use-cases)' },
      to: { path: FRAMEWORK_PACKAGES },
    },
    {
      name: 'adapters-not-to-frameworks-drivers',
      severity: 'error',
      from: { path: '^src/interface-adapters' },
      to: { path: '^src/frameworks-drivers' },
    },
    {
      name: 'no-node-builtins-in-core',
      comment: 'the core stays runtime-agnostic (no fs, http, crypto, async_hooks...)',
      severity: 'error',
      from: { path: '^src/(entities|use-cases)' },
      to: { dependencyTypes: ['core'] },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^test' },
  },
};
