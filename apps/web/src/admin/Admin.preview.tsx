import TeamOverview from './TeamOverview';
import DayTimeline from './DayTimeline';
import { dayTimelineFixture, teamDashboardFixture } from './fixtures';

/** Standalone visual preview: team overview above the per-person day timeline. */
export default function AdminPreview() {
  return (
    <div className="min-h-full bg-bg text-text font-sans px-6 py-6 space-y-6 max-w-6xl mx-auto">
      <TeamOverview
        data={teamDashboardFixture}
        onSelectUser={(id) => console.log('select user', id)}
      />
      <DayTimeline data={dayTimelineFixture} />
    </div>
  );
}
