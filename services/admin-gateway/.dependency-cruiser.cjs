/** Layers: resolvers -> services -> data-sources -> common (never upwards). */
module.exports = {
  forbidden: [
    { name: 'data-sources-are-low-level', severity: 'error', from: { path: '^src/(data-sources|common)' }, to: { path: '^src/(modules|graphql|app.module|bootstrap)' } },
    { name: 'services-not-resolvers', severity: 'error', from: { path: '\\.service\\.ts$' }, to: { path: '\\.resolvers\\.ts$' } },
    { name: 'resolvers-not-data-sources', comment: 'resolvers go through services', severity: 'error', from: { path: '\\.resolvers\\.ts$' }, to: { path: '^src/data-sources/[a-z]+\\.client\\.ts$|^src/common/http-client' } },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: { tsConfig: { fileName: 'tsconfig.json' }, doNotFollow: { path: 'node_modules' }, includeOnly: '^src', enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'] } },
};
