import { EventsClient } from './events.client';
import { IdentityClient } from './identity.client';
import { InsightsClient } from './insights.client';
import { MediaClient } from './media.client';
import { SocialClient } from './social.client';
import { TicketingClient } from './ticketing.client';
import { WalletClient } from './wallet.client';

export interface DataSources {
  identity: IdentityClient;
  social: SocialClient;
  media: MediaClient;
  events: EventsClient;
  wallet: WalletClient;
  ticketing: TicketingClient;
  insights: InsightsClient;
}

export const DATA_SOURCES = Symbol('DATA_SOURCES');
export { EventsClient, IdentityClient, InsightsClient, MediaClient, SocialClient, TicketingClient, WalletClient };
