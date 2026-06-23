import type { ActivityType } from '@cadence/shared';

// Local runtime copy of the activity → colour map (design tokens §9). Kept in
// the web bundle so it never has to resolve a runtime value out of the
// CommonJS-built @cadence/shared package.
export const ACTIVITY_COLORS: Record<ActivityType, string> = {
  coding: '#2bb68c',
  debugging: '#f0a93b',
  research: '#4c9aea',
  agent: '#9a8cf0',
  review: '#8a909b',
};
