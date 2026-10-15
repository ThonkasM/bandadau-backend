import { selfGuardError, toUserErrors } from '../../common/errors';
import { clampFirst, connectionFromPage } from '../../common/relay';
import type { DataSources } from '../../data-sources/data-sources';
import type { IdentityUniversity, IdentityUser } from '../../data-sources/types';
import type { GatewayContext } from '../../graphql/context';

export class UsersService {
  constructor(private readonly ds: DataSources) {}

  async me(ctx: GatewayContext): Promise<IdentityUser> {
    return this.ds.identity.getMe(ctx.call, ctx.bearer as string);
  }

  async users(ctx: GatewayContext, args: { filter?: { query?: string; role?: string; status?: string; universityId?: string } | null; after?: string | null; first?: number | null }) {
    const page = await this.ds.identity.searchUsers(ctx.call, {
      ...(args.filter ?? {}),
      cursor: args.after ?? undefined,
      limit: clampFirst(args.first, 100),
    });
    for (const u of page.items) ctx.loaders.users.prime(u.id, u);
    return connectionFromPage(page.items, page.nextCursor, args.after);
  }

  user(ctx: GatewayContext, id: string): Promise<IdentityUser | null> {
    return ctx.loaders.users.load(id);
  }

  async universities(ctx: GatewayContext): Promise<IdentityUniversity[]> {
    const all = await this.ds.identity.listUniversities(ctx.call);
    for (const u of all) ctx.loaders.universities.prime(u.id, u);
    return all;
  }

  async updateRoles(ctx: GatewayContext, input: { userId: string; roles: string[] }) {
    if (input.roles.length === 0) return { user: null, errors: [selfGuardError('ROLES_REQUIRED', ctx.locale, ['input', 'roles'])] };
    if (input.userId === ctx.principal?.sub && !input.roles.includes('ADMIN')) {
      return { user: null, errors: [selfGuardError('CANNOT_DEMOTE_SELF', ctx.locale, ['input', 'roles'])] };
    }
    try {
      const user = await this.ds.identity.updateRoles(ctx.call, input.userId, input.roles);
      ctx.loaders.users.clear(input.userId).prime(input.userId, user);
      return { user, errors: [] };
    } catch (e) {
      return { user: null, errors: toUserErrors(e) };
    }
  }

  async suspend(ctx: GatewayContext, input: { userId: string; reason: string }) {
    if (input.userId === ctx.principal?.sub) return { user: null, errors: [selfGuardError('CANNOT_SUSPEND_SELF', ctx.locale, ['input', 'userId'])] };
    try {
      const user = await this.ds.identity.updateStatus(ctx.call, input.userId, 'SUSPENDED', input.reason);
      ctx.loaders.users.clear(input.userId).prime(input.userId, user);
      return { user: { ...user, suspensionReason: input.reason, suspendedAt: user.updatedAt }, errors: [] };
    } catch (e) {
      return { user: null, errors: toUserErrors(e) };
    }
  }

  async reactivate(ctx: GatewayContext, input: { userId: string }) {
    try {
      const user = await this.ds.identity.updateStatus(ctx.call, input.userId, 'ACTIVE');
      ctx.loaders.users.clear(input.userId).prime(input.userId, user);
      return { user, errors: [] };
    } catch (e) {
      return { user: null, errors: toUserErrors(e) };
    }
  }

  async createUniversity(ctx: GatewayContext, input: { name: string; allowedDomains: string[] }) {
    try {
      return { university: await this.ds.identity.createUniversity(ctx.call, input), errors: [] };
    } catch (e) {
      return { university: null, errors: toUserErrors(e) };
    }
  }

  async updateUniversity(ctx: GatewayContext, input: { id: string; name?: string | null; allowedDomains?: string[] | null; enabled?: boolean | null }) {
    try {
      const { id, ...patch } = input;
      return { university: await this.ds.identity.updateUniversity(ctx.call, id, patch), errors: [] };
    } catch (e) {
      return { university: null, errors: toUserErrors(e) };
    }
  }
}
