import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Next only reads .env from its own project directory, and the repo keeps one
 * .env at the root so the API and the database tooling cannot drift out of step
 * with it. Reading it here happens before compilation, which is early enough for
 * NEXT_PUBLIC_* values to be inlined.
 *
 * Missing file is not an error — Vercel injects real environment variables, and
 * variables already set in the environment win over the file.
 */
const rootEnv = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
