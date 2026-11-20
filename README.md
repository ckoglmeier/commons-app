# Commons

**Group trips you actually own.**

Commons is a group trip planner. It's free and open source (MIT). You run your own copy on your own Vercel account, and on the free plans it costs $0.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fckoglmeier%2Fcommons-app&project-name=commons&repository-name=commons&root-directory=apps%2Fweb&env=CRON_SECRET&envDescription=CRON_SECRET%20protects%20the%20daily%20job%3A%20any%20long%20random%20string%2C%20such%20as%20the%20output%20of%20openssl%20rand%20-base64%2032.&envLink=https%3A%2F%2Fgithub.com%2Fckoglmeier%2Fcommons-app%2Fblob%2Fmain%2Fdocs%2Fdeploy-with-an-agent.md&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22supabase%22%2C%22productSlug%22%3A%22supabase%22%2C%22protocol%22%3A%22storage%22%7D%5D)

Deploy your own copy in a few clicks. Using an AI assistant? [Copy the deploy guide to your LLM](docs/deploy-with-an-agent.md) and work through it together.

![A trip home page showing where, when and who, with a Needs you note](docs/images/trip-home.jpg)

The screenshots in this README use made-up people, such as Casey and Maya, and a made-up trip.

## Why Commons

- **No per-trip fees.** You host it. Nobody charges you for a trip, a traveler or a month.
- **Your group's plans stay in your accounts.** The database, photos and email are in the Supabase, Vercel and Resend accounts you own.
- **Travelers don't need an app.** They open a link, answer in Messages, or by text if you add a number.
- **Logistics and money are exact.** Who's in, what's planned, what things cost and who owes whom. The trip itself stays fun.
- **It's calm.** Short plain words, a small set of screens, and no feed.

## Everything it takes to get a group trip together

### Settle where, when and who

The Trip home page shows where, when and who, and what still needs an answer. Unknown things read "Still open". When the group is ready, the organizer marks **We're going**.

### Invite people

Share a reusable invite link, or invite people one at a time. With email set up, Commons sends each invitation; without it, you copy the person's private link and send it yourself. People join with a link and an account. They don't download anything. The organizer sees who has joined and who hasn't yet.

### Polls and open questions

Ask the group a quick poll, such as which weekend works. Open questions list what the group still has to settle, like who's hosting dinner. Each one can become a poll. A poll answer is an input. The organizer decides.

### Plan, with a map

Plan has two sections: Activities, and Travel & stays. A map shows the places you've saved. There's no booking. Commons keeps the plan. You book wherever you like.

![The Plan page](docs/images/plan.jpg)

### Messages with Commons

Each traveler gets a private one-to-one thread with Commons in the app. Ask a question, or say "I covered dinner, $120" and Commons drafts the cost. Nothing is saved until you reply with the SAVE code it gives you. Each trip needs the traveler's consent first. STOP and START work, and there are quiet hours. If you've set up email, people get one email notice until they read the message.

If you add Twilio, the same thread also works by text. It's optional.

![A Messages thread where Commons drafts a cost and waits for your SAVE reply](docs/images/messages.jpg)

### Money and settling up

Add costs and choose who shares each one. A budget calculator helps before the trip. At the end, Commons shows who owes whom. Commons doesn't move money. People pay each other outside the app.

![The Money page](docs/images/money.jpg)

### Photos and covers

Add photos to the trip. For the trip's cover, pick one of 12 bundled drawings, use a trip photo or upload your own.

![The Photos page](docs/images/photos.jpg)

### Also

To-dos, with an owner for each. Optional AI help writing polls, if you add an OpenAI key. Optional analytics, if you add PostHog (session replay is off).

## Commons and the usual tools

Most groups use a group chat, a spreadsheet and a cost-splitting app. They work. The cost is that the plan lives in three places.

| | Group chat + spreadsheet + splitting app | Commons |
| --- | --- | --- |
| Where the plan lives | Scattered across chat, a sheet and an app | One trip, one page per part |
| What's still open | Scroll back through the chat | "Still open" and "Needs you" on the trip home |
| Polls | Chat polls that scroll away | Polls tied to the trip, with open questions |
| Money | A separate app, often with each person signing up | Costs, a budget and settling up inside the trip |
| Who owns the data | Several companies | You, in your own accounts |
| What it costs | Varies by app | $0 on free plans, and you host it |
| Setup | None | You deploy it once |

### Where they do more

Commons is a web app you host. Be honest with yourself about what you're giving up.

| | The usual tools | Commons |
| --- | --- | --- |
| Native phone apps | Yes, for most chat and splitting apps | No. It's a web app. |
| Booking | Travel apps book flights and stays | No booking at all |
| Real-time group chat | Group chats are real time | No. Messages is a private thread with Commons, not a group chat. |
| Works offline | Some apps do | No |
| Zero setup | Yes | No. You deploy it once. |

## What it costs

On free plans, nothing. Here's what the free plans include.

| Service | What it does | Free plan limit that matters | What happens at the limit |
| --- | --- | --- | --- |
| Vercel Hobby | Runs the site | Non-commercial use only. Scheduled jobs run at most once a day. Typical monthly use includes 1,000,000 function invocations and 100 GB of data transfer. | Vercel pauses Hobby projects that exceed included usage. Commons has one daily job, which fits. |
| Supabase Free | Database, sign-in, photos | 500 MB database, 1 GB file storage, 5 GB egress, 2 active projects. Pauses after a week of low activity. | Commons's daily job keeps the project awake. If it pauses, [restore it](docs/self-hosting.md#if-supabase-paused-your-project). |
| Resend Free (optional) | Sign-in, invitation and notice emails | 100 emails a day, 3,000 a month, 3 domains. You need a verified domain to email other people. | Resend refuses emails over the cap until the quota resets or you upgrade. Without Resend, people sign in with a password and you share invite links yourself. |
| Twilio (optional) | Texting | No free plan. US toll-free number $2.15 a month, about $0.0083 a text segment plus carrier fees of about half a cent. | You only pay if you add it. |

Checked November 2026. Sources: [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Vercel Hobby plan](https://vercel.com/docs/plans/hobby), [Vercel plans](https://vercel.com/docs/plans), [Supabase pricing](https://supabase.com/pricing), [Supabase free project pausing](https://supabase.com/kb/faqs/platform/free-project-pausing), [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [Resend domains](https://resend.com/docs/dashboard/domains/introduction), [Twilio US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us). Vercel's Hobby terms limit it to non-commercial use: check Vercel's current terms before relying on it. Limits change. Check each provider's page before you rely on a number.

If you run Commons for a business or charge for it, use a paid Vercel plan.

## Get started

1. Click **Deploy with Vercel** above, or follow the [deploy guide](docs/deploy-with-an-agent.md).
2. Add Supabase when asked, and set `CRON_SECRET`.
3. Open your site and choose **Start a trip**. With no email set up, you create an account with an email and a password. The first account is the instance admin, so do this before you share the address. Until you add email, people sign in with a password and you share trip invite links yourself.
4. Optional: add **Resend** from the project's **Integrations** tab, set `COMMONS_EMAIL_FROM`, verify your sending domain in Resend, and redeploy. Then Commons emails sign-in links, invitations and new-message notices.
5. Open your account menu (your initials) and choose **Who can join**. Pick invited people only (the default), people at listed email domains, or anyone.
6. Optional: add your own domain, OpenAI for poll writing help, PostHog for analytics, or Twilio for texting.

Details, settings, updating your copy and troubleshooting: [Self-hosting](docs/self-hosting.md). All settings are in [.env.example](.env.example).

## Use it for other group plans

Commons starts every plan from a template. Trips are the default. A family reunion ships as an example.

![A family reunion plan started from the reunion template](docs/images/family-reunion.jpg)

A template sets the starting questions, polls, plan section names, to-dos and money hints. Writing one means editing a single file. See [Templates](docs/templates.md).

## Run it on your computer

You need Node 24 and Postgres.

```bash
npm ci
cp .env.example .env.local
createdb commons
```

For a quick look with made-up people and no Supabase account, set these in `.env.local`. Leave the three Supabase lines empty:

```bash
DATABASE_URL=postgresql://localhost:5432/commons
DATABASE_DIRECT_URL=postgresql://localhost:5432/commons
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
COMMONS_DEV_SIGN_IN=true
COMMONS_LOCAL_MOMENTS_DIR=.local/moments
```

If your Postgres needs a user or a password, put them in both addresses, such as `postgresql://postgres:password@localhost:5432/commons`.

Then run these in one terminal, so the settings you loaded stay in effect:

```bash
set -a; source .env.local; set +a
```

```bash
npm run db:test:bootstrap -w @commons/database
```

```bash
npm run db:migrate
```

```bash
npm run dev
```

The second command adds the few pieces of Supabase that a plain Postgres database doesn't have. The tests use the same step.

Open http://localhost:3000 and sign in with any made-up email. The first person you sign in as becomes the instance admin. The local test sign-in works only with `npm run dev`, on localhost, with the Supabase settings empty. Emails print to the server log instead of sending, and photos are kept in a folder on your computer. Saving a trip cover needs Supabase Storage, so that one thing can't be tried locally.

## Checks

```bash
npm run typecheck && npm run lint && npm test
```

Database tests run when `COMMONS_RUN_DATABASE_TESTS=1` and `TEST_DATABASE_URL` points at a disposable local database on `127.0.0.1` whose name ends in `_test`. Prepare that database first with `npm run db:test:bootstrap -w @commons/database` and `npm run db:migrate`, with `DATABASE_DIRECT_URL` set to the same address.

## License

The code is MIT licensed (see [LICENSE](LICENSE)). The Commons name and the cover library are reserved. Twelve covers are included for use with this software. If you run a public copy, give it your own name. See [NOTICE.md](NOTICE.md).

## Contributing and support

Maintained as I use it. Issues are welcome. No support is promised. Contributors: read [DESIGN.md](DESIGN.md) and [AGENTS.md](AGENTS.md) before changing screens.
