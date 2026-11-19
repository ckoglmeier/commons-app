# Commons

Commons is a group trip planner. A group settles where, when and who's in, keeps one shared plan, asks quick polls, tracks shared costs and settles up, and hears from Commons in a private thread in the app. It's free and open source: you run your own copy on your own Vercel account.

Trips are the first template. The engine underneath coordinates any group plan with real dates, places and shared money; see [Writing a template](docs/writing-a-template.md).

## Deploy your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FOWNER%2Fcommons&project-name=commons&repository-name=commons&root-directory=apps%2Fweb&env=CRON_SECRET%2CCOMMONS_EMAIL_FROM&envDescription=CRON_SECRET%20protects%20the%20daily%20job%3A%20any%20long%20random%20string%2C%20such%20as%20the%20output%20of%20openssl%20rand%20-base64%2032.%20COMMONS_EMAIL_FROM%20is%20the%20sender%20for%20sign-in%20and%20invitation%20emails%2C%20like%20Commons%20%3Ctrips%40yourdomain.com%3E%2C%20on%20a%20domain%20you%20verify%20in%20Resend.&envLink=https%3A%2F%2Fgithub.com%2FOWNER%2Fcommons%2Fblob%2Fmain%2Fdocs%2Fdeploy-with-an-agent.md&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22supabase%22%2C%22productSlug%22%3A%22supabase%22%2C%22protocol%22%3A%22storage%22%7D%2C%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22resend%22%2C%22productSlug%22%3A%22resend%22%7D%5D)

The button copies this repository to your GitHub account and creates a Vercel project with Supabase (database, sign-in, photos) and Resend (email). The first person to sign in becomes the admin and chooses who else can create accounts. Invited only is the default.

Step by step, or with an AI assistant: [Deploy with an agent](docs/deploy-with-an-agent.md).

> Before publishing, replace `OWNER` in the button link with the repository's real GitHub owner.

## Run it on your computer

You need Node 24 and Postgres.

```bash
npm ci
cp .env.example .env.local
```

For a quick look with made-up people and no Supabase account, set these in `.env.local`:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/commons
DATABASE_DIRECT_URL=postgresql://postgres@127.0.0.1:5432/commons
COMMONS_INVITATION_TOKEN_KEY=   # openssl rand -base64 32
COMMONS_DEV_SIGN_IN=true
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Then migrate and start:

```bash
set -a; source .env.local; set +a; npm run db:migrate
```

```bash
npm run dev
```

Open http://localhost:3000 and sign in with any made-up email. The local test sign-in works only with `npm run dev`, on localhost, with the Supabase settings empty. Emails print to the server log instead of sending.

## Optional services

Each is off and hidden until its settings exist: AI help writing polls (OpenAI), product analytics (PostHog, with session replay off by default), and texting (Twilio). See `.env.example`.

## Checks

```bash
npm run typecheck && npm run lint && npm test
```

Database tests run when `COMMONS_RUN_DATABASE_TESTS=1` and `TEST_DATABASE_URL` points at a disposable local database whose name ends in `_test`.

## License

The code is MIT licensed (see [LICENSE](LICENSE)). The Commons name and the cover library are reserved; twelve covers are included for use with this software. See [NOTICE.md](NOTICE.md).

Contributors: read [DESIGN.md](DESIGN.md) and [AGENTS.md](AGENTS.md) before changing screens.
