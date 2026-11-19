import { provisionDemoUser } from "./onboarding-repository";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const authUserId = argument("auth-user-id");
const displayName = argument("name");
const email = argument("email");
const commonsSlugs = (argument("commons") ?? "")
  .split(",")
  .map((slug) => slug.trim())
  .filter(Boolean);

if (!authUserId || !displayName || !commonsSlugs.length) {
  console.error(
    "Usage: npm run db:provision:demo-user -- --auth-user-id <uuid> --name \"Name\" --commons private-trip-slug [--email person@example.com]",
  );
  process.exit(1);
}

const result = await provisionDemoUser({
  authUserId,
  displayName,
  email,
  commonsSlugs,
});

console.log(
  `${result.displayName} can now open ${result.memberships.map((trip) => trip.name).join(", ")}.`,
);
