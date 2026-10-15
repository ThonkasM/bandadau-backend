import { EventsClient } from './events.client';
import { IdentityClient } from './identity.client';
import { MediaClient } from './media.client';
import { SocialClient } from './social.client';
import { WalletClient } from './wallet.client';

export interface DataSources {
  identity: IdentityClient;
  social: SocialClient;
  media: MediaClient;
  events: EventsClient;
  wallet: WalletClient;
}

export const DATA_SOURCES = Symbol('DATA_SOURCES');
export { EventsClient, IdentityClient, MediaClient, SocialClient, WalletClient };
