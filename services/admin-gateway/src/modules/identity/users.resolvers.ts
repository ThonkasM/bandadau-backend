import type { IdentityUniversity, IdentityUser } from '../../data-sources/types';
import type { GatewayContext } from '../../graphql/context';
import type { UsersService } from './users.service';

export function usersResolvers(service: UsersService) {
  return {
    Query: {
      me: (_: unknown, __: unknown, ctx: GatewayContext) => service.me(ctx),
      users: (_: unknown, args: never, ctx: GatewayContext) => service.users(ctx, args),
      user: (_: unknown, args: { id: string }, ctx: GatewayContext) => service.user(ctx, args.id),
      universities: (_: unknown, __: unknown, ctx: GatewayContext) => service.universities(ctx),
    },
    Mutation: {
      updateUserRoles: (_: unknown, a: { input: { userId: string; roles: string[] } }, ctx: GatewayContext) => service.updateRoles(ctx, a.input),
      suspendUser: (_: unknown, a: { input: { userId: string; reason: string } }, ctx: GatewayContext) => service.suspend(ctx, a.input),
      reactivateUser: (_: unknown, a: { input: { userId: string } }, ctx: GatewayContext) => service.reactivate(ctx, a.input),
      createUniversity: (_: unknown, a: { input: { name: string; allowedDomains: string[] } }, ctx: GatewayContext) => service.createUniversity(ctx, a.input),
    },
    User: {
      university: (u: IdentityUser, _: unknown, ctx: GatewayContext) => (u.universityId ? ctx.loaders.universities.load(u.universityId) : null),
      displayName: async (u: IdentityUser, _: unknown, ctx: GatewayContext) => (await ctx.loaders.profiles.load(u.id))?.displayName ?? null,
      career: async (u: IdentityUser, _: unknown, ctx: GatewayContext) => (await ctx.loaders.profiles.load(u.id))?.career ?? null,
      semester: async (u: IdentityUser, _: unknown, ctx: GatewayContext) => (await ctx.loaders.profiles.load(u.id))?.semester ?? null,
      avatarUrl: async (u: IdentityUser, _: unknown, ctx: GatewayContext) => (await ctx.loaders.profiles.load(u.id))?.avatarUrl ?? null,
      suspendedAt: (u: IdentityUser & { suspendedAt?: string | null }) => u.suspendedAt ?? null,
      suspensionReason: (u: IdentityUser & { suspensionReason?: string | null }) => u.suspensionReason ?? null,
    },
    University: {
      createdAt: (u: IdentityUniversity) => u.createdAt ?? '1970-01-01T00:00:00Z',
    },
  };
}
