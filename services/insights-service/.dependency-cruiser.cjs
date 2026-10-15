/** Clean Architecture dependency rule: source dependencies point inward only. */
const FRAMEWORKS = '^(@nestjs|@aws-sdk|@bandada|amqplib|amqp-connection-manager|express|jose|rxjs|reflect-metadata)';

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
      name: 'entities-no-frameworks',
      severity: 'error',
      from: { path: '^src/entities' },
      to: { path: FRAMEWORKS, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'use-cases-only-inward',
      comment: 'use-cases depend on entities and use-cases only',
      severity: 'error',
      from: { path: '^src/use-cases' },
      to: { path: '^src/(interface-adapters|frameworks-drivers)' },
    },
    {
      name: 'use-cases-no-frameworks',
      severity: 'error',
      from: { path: '^src/use-cases' },
      to: { path: FRAMEWORKS },
    },
    {
      name: 'adapters-not-frameworks',
      comment: 'interface-adapters never import frameworks-drivers',
      severity: 'error',
      from: { path: '^src/interface-adapters' },
      to: { path: '^src/frameworks-drivers' },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^src/.*\\.spec\\.ts$' },
    includeOnly: '^src|^node_modules',
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'] },
  },
};
