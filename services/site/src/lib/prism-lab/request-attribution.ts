import type { LabRequestOriginSnapshot } from './contracts';

export function requestCreatorLabel(origin: LabRequestOriginSnapshot | null | undefined) {
  const creator = origin?.creator;
  if (!creator) return 'Creator not recorded';
  return creator.displayName?.trim() || creator.id;
}

export function requestInitiatorLabel(
  origin: LabRequestOriginSnapshot | null | undefined,
  requestedByDisplayName: string | null | undefined,
) {
  return requestedByDisplayName?.trim()
    || origin?.actorDisplayName?.trim()
    || origin?.actorId?.trim()
    || (origin?.actorType === 'external-subject' ? 'External participant' : 'Initiator not recorded');
}
