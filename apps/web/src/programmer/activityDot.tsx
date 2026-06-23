import type { ActivityType } from '@cadence/shared';
import { ACTIVITY_COLORS } from '../lib/activity';

/** The faint neutral used when no activity has been inferred yet. */
const NEUTRAL = '#686d77'; // text3

export function activityColor(activity: ActivityType | null): string {
  return activity ? ACTIVITY_COLORS[activity] : NEUTRAL;
}

/** A small filled dot colored by inferred activity. */
export function ActivityDot({
  activity,
  size = 8,
  title,
}: {
  activity: ActivityType | null;
  size?: number;
  title?: string;
}) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      title={title ?? (activity ?? 'idle')}
      className="inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: activityColor(activity),
      }}
    />
  );
}
