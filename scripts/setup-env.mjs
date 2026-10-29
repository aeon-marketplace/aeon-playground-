import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const target = path.resolve(process.cwd(), ".env.local");

if (existsSync(target)) {
  console.log(".env.local already exists. Leaving it untouched.");
  process.exit(0);
}

const authSecret = randomBytes(32).toString("base64url");
const encryptionKey = randomBytes(32).toString("base64");

const contents = `# Generated locally by \`npm run setup\`. Do not commit this file.
APP_URL=http://localhost:3000
AUTH_SECRET=${authSecret}
ENCRYPTION_KEY=${encryptionKey}
DATABASE_PATH=./data/playground.db
ALLOW_REGISTRATION=true
ALLOW_INSECURE_LOCAL_ENDPOINTS=false
ALLOW_PAID_BYOK=false
SESSION_TTL_DAYS=7
CHAT_RATE_LIMIT_PER_MINUTE=20
`;

writeFileSync(target, contents, { encoding: "utf8", mode: 0o600 });
console.log("Created .env.local with freshly generated AUTH_SECRET and ENCRYPTION_KEY.");
console.log("Provider API keys are NOT included. Add BYOK keys through the app UI.");
