import type { AppConfig, CommunityProvider } from './config.js';

export interface IntegrationMeta {
  provider: CommunityProvider;
  linkingEnabled: boolean;
  displayName: string | null;
  prism: {
    enabled: boolean;
    baseUrl: string;
  };
}

function providerDisplayName(provider: CommunityProvider) {
  if (provider === 'discord') return 'Discord';
  if (provider === 'slack') return 'Slack';
  if (provider === 'telegram') return 'Telegram';
  return null;
}

export function getIntegrationMeta(config: AppConfig): IntegrationMeta {
  const providerToken =
    (config.communityProvider === 'discord' && config.discordBotToken)
    || (config.communityProvider === 'slack' && config.slackBotToken)
    || (config.communityProvider === 'telegram' && config.telegramBotToken)
    || null;

  return {
    provider: config.communityProvider,
    linkingEnabled: Boolean(config.communityProvider && providerToken),
    displayName: providerDisplayName(config.communityProvider),
    prism: {
      enabled: Boolean(process.env.PRISM_READ_API_KEY || process.env.PRISM_INGEST_API_KEY),
      baseUrl: config.prismMemoryBaseUrl,
    },
  };
}