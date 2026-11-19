import { readFile } from "node:fs/promises";
import { provisionParticipantEmails } from "./onboarding-repository";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const commonsSlug = argument("commons");
const inputPath = argument("input");
if (!commonsSlug || !inputPath) {
  console.error(
    "Usage: npm run db:provision:emails -- --commons <slug> --input <private-json-file>",
  );
  process.exit(1);
}

const participants = JSON.parse(await readFile(inputPath, "utf8")) as Array<{
  displayName: string;
  email: string;
}>;
const result = await provisionParticipantEmails({
  commonsSlug,
  participants,
});

console.log(
  `${result.participantNames.length} participant email identities are ready for ${result.commonsName}: ${result.participantNames.join(", ")}. No messages were sent.`,
);
