import { buildApp } from './app';
import { env } from './env';
import { seedTeams } from './scripts/seed-teams';

async function main(): Promise<void> {
  const app = await buildApp();
  // Ensure built-in teams exist + backfill any team-less rows (idempotent, cheap).
  try {
    const r = await seedTeams();
    app.log.info({ ...r }, 'seed-teams');
  } catch (err) {
    app.log.error({ err }, 'seed-teams failed (continuing)');
  }
  try {
    // MUST bind 0.0.0.0 so DigitalOcean App Platform can reach it (§10).
    await app.listen({ host: '0.0.0.0', port: env.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
