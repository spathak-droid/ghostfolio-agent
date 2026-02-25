import { SymbolProfile } from '@prisma/client';

import { Statistics } from './statistics.interface';
import { SubscriptionOffer } from './subscription-offer.interface';

export interface InfoItem {
  adminAccessToken?: string;
  baseCurrency: string;
  benchmarks: Partial<SymbolProfile>[];
  countriesOfSubscribers?: string[];
  currencies: string[];
  demoAuthToken: string;
  fearAndGreedDataSource?: string;
  globalPermissions: string[];
  hasAdminLogin?: boolean;
  isDataGatheringEnabled?: string;
  isReadOnlyMode?: boolean;
  statistics: Statistics;
  subscriptionOffer?: SubscriptionOffer;
  agentWidgetScriptUrl?: string;
}
