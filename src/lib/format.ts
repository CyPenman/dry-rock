export function formatAgeWords(fetchedAt: number): string {
  const mins = Math.round((Date.now() - fetchedAt) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `data is ${mins} minute${mins === 1 ? '' : 's'} old`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `data is ${hours} hour${hours === 1 ? '' : 's'} old`;
  const days = Math.round(hours / 24);
  return `data is ${days} day${days === 1 ? '' : 's'} old`;
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatTimeOfDay(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const KM_TO_MILES = 0.621371;

/** Distance is modelled in km internally (§4.9); this converts only for display. */
export function formatDistanceMiles(km: number): string {
  const miles = km * KM_TO_MILES;
  return miles < 10 ? `${miles.toFixed(1)}mi` : `${Math.round(miles)}mi`;
}

export const LIMITING_FACTOR_LABEL: Record<string, string> = {
  rain: 'limited by rain',
  seepage: 'limited by seepage',
  condensation: 'limited by condensation',
  snow: 'under snow',
  frozen: 'frozen',
  none: '',
};
