import { buildApp } from './app';
import { env } from './env';

async function main(): Promise<void> {
  const app = await buildApp();
  try {
    // MUST bind 0.0.0.0 so DigitalOcean App Platform can reach it (§10).
    await app.listen({ host: '0.0.0.0', port: env.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
