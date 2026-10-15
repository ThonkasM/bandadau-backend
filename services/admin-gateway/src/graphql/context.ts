import type { AuthPrincipal } from '@bandada/auth-ts';
import type { Locale } from '@bandada/i18n';
import DataLoader from 'dataloader';
import type { GraphQLError } from 'graphql';

import type { DataSources } from '../data-sources/data-sources';
import type { CallContext, IdentityUniversity, IdentityUser, MediaUrl, SagaDto, SocialProfile } from '../data-sources/types';

export interface Loaders {
  users: DataLoader<string, IdentityUser | null>;
  profiles: DataLoader<string, SocialProfile | null>;
  media: DataLoader<string, MediaUrl | null>;
  universities: DataLoader<string, IdentityUniversity | null>;
  sagas: DataLoader<string, SagaDto[]>;
}

export interface GatewayContext {
  principal?: AuthPrincipal;
  bearer?: string;
  locale: Locale;
  correlationId: string;
  call: CallContext;
  loaders: Loaders;
  /** Errors of components that failed but did not abort the operation (partial results). */
  partialErrors: GraphQLError[];
}

/** DataLoaders live as long as one request: never share them between users. */
export function createLoaders(ds: DataSources, call: CallContext, options: { cache?: boolean } = {}): Loaders {
  const opt = { cache: options.cache ?? true };
  const loader = <V>(batch: (keys: readonly string[]) => Promise<V[]>) => new DataLoader<string, V>(async (keys) => batch(keys), opt);
  return {
    users: loader<IdentityUser | null>(async (ids) => {
      const found = new Map<string, IdentityUser>();
      for (let i = 0; i < ids.length; i += 50) {
        const page = await ds.identity.searchUsers(call, { ids: ids.slice(i, i + 50), limit: 50 });
        for (const user of page.items) found.set(user.id, user);
      }
      return ids.map((id) => found.get(id) ?? null);
    }),
    profiles: loader<SocialProfile | null>((ids) => Promise.all(ids.map((id) => ds.social.getProfile(call, id).catch(() => null)))),
    media: loader<MediaUrl | null>(async (ids) => {
      const found = new Map((await ds.media.getUrls(call, [...ids])).map((m) => [m.mediaId, m]));
      return ids.map((id) => found.get(id) ?? null);
    }),
    sagas: loader<SagaDto[]>(async (keys) => {
      const recent = (await ds.events.listSagas(call, { limit: 50 })).items;
      return keys.map(() => recent);
    }),
    universities: loader<IdentityUniversity | null>(async (ids) => {
      const all = new Map((await ds.identity.listUniversities(call)).map((u) => [u.id, u]));
      return ids.map((id) => all.get(id) ?? null);
    }),
  };
}
