export type HomeModuleType = 'profile-checklist' | 'top-contributors' | 'daily-brief';

export interface HomeModuleDefinition {
  id: string;
  type: HomeModuleType;
  label: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  defaultEnabled: boolean;
  defaultDisplayOrder: number;
  defaultVisibilityRole: string | null;
}

const homeModuleDefinitions: HomeModuleDefinition[] = [
  {
    id: 'module-profile-checklist',
    type: 'profile-checklist',
    label: 'Profile checklist',
    description: 'Show the member what profile essentials are still missing and point them at the quick editor.',
    defaultConfig: {
      title: 'Complete your profile',
      description: 'Finish the essentials so other members can find you and understand what you do.',
      minSkills: 2,
    },
    defaultEnabled: true,
    defaultDisplayOrder: 1,
    defaultVisibilityRole: null,
  },
  {
    id: 'module-top-contributors',
    type: 'top-contributors',
    label: 'Top contributors',
    description: 'Surface the live leaderboard on the member home without forcing a context switch.',
    defaultConfig: {
      title: 'Top contributors',
      description: 'See who is moving the leaderboard right now.',
      limit: 5,
    },
    defaultEnabled: true,
    defaultDisplayOrder: 2,
    defaultVisibilityRole: null,
  },
  {
    id: 'module-daily-brief',
    type: 'daily-brief',
    label: 'Daily brief',
    description: 'Summarize current member momentum and Prism availability in one compact home module.',
    defaultConfig: {
      title: 'Daily brief',
      description: 'A lightweight summary of your current momentum, recent activity, and Prism status.',
    },
    defaultEnabled: true,
    defaultDisplayOrder: 3,
    defaultVisibilityRole: null,
  },
];

function normalizeString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.trunc(parsed);
  if (normalized < 1) {
    return fallback;
  }

  return Math.min(normalized, max);
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

export function getDefaultHomeModules() {
  return homeModuleDefinitions.map((definition) => ({
    ...definition,
    defaultConfig: { ...definition.defaultConfig },
  }));
}

export function getHomeModuleDefinition(moduleId: string, type?: string) {
  return homeModuleDefinitions.find((definition) => definition.id === moduleId)
    ?? homeModuleDefinitions.find((definition) => definition.type === type);
}

export function normalizeHomeModuleConfig(type: string, value: unknown) {
  const candidate = asRecord(value);

  if (type === 'profile-checklist') {
    return {
      title: normalizeString(candidate.title, 'Complete your profile'),
      description: normalizeString(
        candidate.description,
        'Finish the essentials so other members can find you and understand what you do.',
      ),
      minSkills: normalizePositiveInteger(candidate.minSkills, 2, 10),
    };
  }

  if (type === 'top-contributors') {
    return {
      title: normalizeString(candidate.title, 'Top contributors'),
      description: normalizeString(candidate.description, 'See who is moving the leaderboard right now.'),
      limit: normalizePositiveInteger(candidate.limit, 5, 12),
    };
  }

  if (type === 'daily-brief') {
    return {
      title: normalizeString(candidate.title, 'Daily brief'),
      description: normalizeString(
        candidate.description,
        'A lightweight summary of your current momentum, recent activity, and Prism status.',
      ),
    };
  }

  return candidate;
}