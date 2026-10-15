import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeExecutableSchema } from '@graphql-tools/schema';
import { getDirective, MapperKind, mapSchema } from '@graphql-tools/utils';
import { defaultFieldResolver, type GraphQLResolveInfo, type GraphQLSchema } from 'graphql';

import { forbidden, unauthenticated } from '../common/errors';
import type { GatewayContext } from './context';
import { scalarResolvers } from './scalars';

export const SCHEMA_PATH = join(__dirname, '..', '..', 'schema', 'admin.graphql');

export const loadSdl = (path = SCHEMA_PATH): string => readFileSync(path, 'utf8');

type Resolvers = Record<string, unknown>;

function assertAccess(ctx: GatewayContext, roles: string[] | undefined): void {
  if (!ctx.principal) throw unauthenticated();
  if (roles && roles.length > 0 && !roles.some((r) => ctx.principal?.roles.includes(r as never))) throw forbidden();
}

/**
 * Schema-first: SDL copy of the contract + resolvers. `@auth(requires)` is enforced per field; every root field
 * additionally requires a valid session (docs: "Sin @auth en un campo raíz => se exige sesión válida").
 */
export function buildSchema(resolvers: Resolvers, sdl = loadSdl()): GraphQLSchema {
  const schema = makeExecutableSchema({ typeDefs: sdl, resolvers: { ...scalarResolvers, ...resolvers } as never });
  const roots = new Set(
    [schema.getQueryType(), schema.getMutationType(), schema.getSubscriptionType()].filter(Boolean).map((t) => (t as { name: string }).name),
  );

  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig, _fieldName, typeName) => {
      const directive = getDirective(schema, fieldConfig, 'auth')?.[0];
      const typeDirective = getDirective(schema, schema.getType(typeName) as never, 'auth')?.[0];
      const roles = ((directive ?? typeDirective)?.requires as string[] | undefined) ?? undefined;
      const isRoot = roots.has(typeName);
      if (!isRoot && !directive && !typeDirective) return fieldConfig;

      const resolve = fieldConfig.resolve ?? defaultFieldResolver;
      const guarded = { ...fieldConfig, resolve: (source: unknown, args: unknown, ctx: GatewayContext, info: GraphQLResolveInfo) => {
        assertAccess(ctx, roles);
        return resolve(source, args as never, ctx, info);
      } };
      if (fieldConfig.subscribe) {
        const subscribe = fieldConfig.subscribe;
        return {
          ...guarded,
          subscribe: (source: unknown, args: unknown, ctx: GatewayContext, info: GraphQLResolveInfo) => {
            assertAccess(ctx, roles);
            return subscribe(source, args as never, ctx, info);
          },
        };
      }
      return guarded as never;
    },
  });
}
