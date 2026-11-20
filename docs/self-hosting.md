# Self-hosting Commons

This guide covers running your own copy after you've deployed it. To deploy, start with the [README](../README.md) or [Deploy with an agent](deploy-with-an-agent.md).

## Settings

Every setting is listed, with a comment, in [`.env.example`](../.env.example). On Vercel, the Supabase and Resend integrations fill in most of them. Change a setting in **Settings → Environment Variables** and redeploy.

You must have these: the database connections, the Supabase URL and keys, `NEXT_PUBLIC_SITE_URL` (on Vercel the production address is used when it's empty) and `CRON_SECRET`. Everything else is optional, including email: without `RESEND_API_KEY` and `COMMONS_EMAIL_FROM`, people sign in with a password and you share invite links yourself (see [Running without email](#running-without-email)).

## Who can join

The first account to sign in is the instance admin. Open your account menu (your initials) and choose **Who can join**. It's also on your Profile. Then pick:

- **Invited people only** (default). People join when someone invites them to a trip.
- **People at these email domains.** Anyone with an email at the domains you list.
- **Anyone with the link.** Anyone who finds your site.

Travelers you invite never see this choice. They follow their invitation.

## Your own domain

A `vercel.app` address works. To use your own:

1. Add the domain under **Settings → Domains** in Vercel.
2. Set `NEXT_PUBLIC_SITE_URL` to `https://` plus the domain.
3. Redeploy.

Sign-in links and invitations use `NEXT_PUBLIC_SITE_URL`.

## Running without email

With no Resend settings, Commons sends no email at all:

- People sign in with an email and a password. New people choose **Create account**.
- Organizers share links themselves. In a trip's **People**, **Share an invite link** copies one link the whole group can use. For one person, add them, open their row and choose **Copy private link**. Their row reads **Not sent** until they join, because Commons sent nothing.
- With **Invited people only**, a new account needs one of those links. An invitation sent to someone's address isn't enough, because nobody has proved they own it.
- Messages with Commons works in the app. People see new messages when they open Commons.
- Forgotten passwords: the instance admin sets a temporary one under **Who can join → Reset someone's password**, and the person changes it on their Profile.
- Email domain rules only check what people type, since addresses aren't confirmed.
- Nobody's address is confirmed, so treat an account's email as a name the person chose. Share links only with people you mean to invite, and keep **Who can join** on invited people only unless you trust everyone who can reach your site.

Add Resend at any time and redeploy. Sign-in then switches to emailed links. Accounts made with a password keep working, as long as the email on the account is a real address the person can read.

Going the other way works too: remove the Resend settings and redeploy, and sign-in switches to passwords. People who only ever signed in with emailed links have no password yet, so set a temporary one for each of them under **Who can join → Reset someone's password**.

## Adding email with Resend

In the Vercel project, add **Resend** from the **Integrations** tab (or create an API key at resend.com and add it as `RESEND_API_KEY`), then verify a domain. Resend needs a verified domain to email people other than yourself.

1. In Resend, open **Domains → Add domain**.
2. Add the DNS records Resend shows at your domain registrar.
3. Wait for the domain to show **Verified**. It usually takes minutes and can take longer.
4. Set `COMMONS_EMAIL_FROM` to an address on that domain, such as `Commons <trips@yourdomain.com>`, and redeploy.

Until then, sign-in works for you and invitations to other people wait.

## Your terms and privacy pages

The built-in terms and privacy pages are templates, not legal advice. You are responsible for the copy you run and for checking that its terms suit where you and your travelers live. Fill in `COMMONS_INSTANCE_OWNER_NAME`, `COMMONS_INSTANCE_CONTACT_EMAIL` and `COMMONS_INSTANCE_JURISDICTION`, or link your own pages with `COMMONS_TERMS_URL` and `COMMONS_PRIVACY_URL`. If you run a public copy, give it your own name. See [NOTICE.md](../NOTICE.md).

## Maps

The trip map uses OpenStreetMap's public tiles, with attribution shown on the map. Their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) is fine for a group's own trips. If your copy gets heavy public use, switch to a commercial tile provider.

## Optional services

Each service is off and hidden until its settings exist.

| Service | Setting | What it adds |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | AI help writing polls. Trip content goes to OpenAI only when someone asks for help. |
| PostHog | `NEXT_PUBLIC_POSTHOG_KEY` | Product analytics. Session replay stays off unless you set `NEXT_PUBLIC_POSTHOG_REPLAY=true`. |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` | Texting. Use a verified toll-free number. Messages with Commons works in the app without it. |

Texting costs money. See [what it costs](../README.md#what-it-costs).

## The daily job

Commons has one scheduled job, `/api/internal/daily/`, set in `apps/web/vercel.json` to run once a day at 16:00 UTC, which is morning in the Americas. Vercel Hobby allows daily jobs only, and may run it any time within the scheduled hour.

If your group lives elsewhere, pick an hour that is morning for them: in `apps/web/vercel.json`, the schedule `0 16 * * *` means minute 0 of hour 16 in UTC, so `0 7 * * *` is 07:00 UTC. Commons holds its own messages during a trip's quiet hours, and a job that runs in the group's night finds them still held.

The job:

- makes one small database request, which keeps a free Supabase project awake;
- retries invitation and poll emails that failed;
- sends any message notices that were held;
- runs the messaging pass.

Most of this also happens right away when people use the app. The job catches up on what waited.

The job needs `CRON_SECRET`. Without it, the job returns an error and does nothing, and your Supabase project can pause. In Vercel, **Settings → Cron Jobs** shows whether it ran.

## If Supabase paused your project

Free Supabase projects pause after about a week of low database activity. The daily job prevents that. A project can still pause if the job stopped running.

To restore it:

1. Open the Supabase dashboard and select the project.
2. Choose **Restore project** and wait until it shows as active. Supabase says a paused project can be restored for one year.
3. Open your Commons site. You don't need to redeploy. Your data is kept.

Then check that `CRON_SECRET` is set and the daily job runs. Source: [Supabase on free project pausing](https://supabase.com/kb/faqs/platform/free-project-pausing) and [restoring a paused project](https://supabase.com/docs/guides/platform/upgrading#restoring-a-paused-project).

## Updating your copy

The Deploy button copied the repository to your GitHub account. To get new changes:

1. Add the original repository as `upstream`: `git remote add upstream https://github.com/ckoglmeier/commons-app.git`.
2. Run `git fetch upstream` and `git merge upstream/main` on your main branch. Fix any conflicts.
3. Push. Vercel builds and deploys.

The build runs database migrations. Back up before you update (next section). Read the release notes or commit messages for anything that changes settings. If you changed code yourself, expect to resolve conflicts.

## Backups

Your data is in Supabase: the database and the photos in the `commons-moments` storage bucket. Commons doesn't back anything up for you.

- What Supabase backs up depends on your plan. Check [Supabase's backup docs](https://supabase.com/docs/guides/platform/backups) before you rely on it.
- To keep your own copy, dump the database with `pg_dump` using the direct connection string, and download the photos from the storage bucket.

Test a restore at least once before you need one.

## Troubleshooting

**The build fails on migrations.** Open the build log and find the first line that mentions a migration. A new, empty Supabase project migrates cleanly. If you reused a database that already had other tables, use an empty one. Missing `DATABASE_DIRECT_URL` or `POSTGRES_URL_NON_POOLING` also stops migrations: finish adding Supabase, then redeploy.

**Sign-in emails don't arrive.** Open Resend's **Logs**. If the domain isn't verified, Resend only delivers to your own address. Check that `COMMONS_EMAIL_FROM` uses the verified domain and that `RESEND_API_KEY` is set. Check the spam folder. Free Resend plans stop at 100 emails a day.

**An invitation says "Needs attention".** The email failed to send or the invitation expired. Open the trip's People list to see which invitation needs attention. If it keeps failing, check Resend's Logs and your domain verification.

**Photos won't upload.** Photos are stored in Supabase Storage. Check that the Supabase URL and the service role key are set, and that the project isn't paused. (For local development only, `COMMONS_LOCAL_MOMENTS_DIR` stores photos in a folder instead.)

**The daily job returns 503 or 401.** A 503 means `CRON_SECRET` isn't set. A 401 means the secret sent doesn't match. Set it in Vercel (at least 16 characters; `openssl rand -base64 32` works), then redeploy.

**Texts don't send.** All three Twilio settings must be set, and the number must be verified for toll-free texting. `COMMONS_SMS_SEND_MODE=log` prints texts to the server log instead of sending.

If something else breaks, open an issue and include the first error line from the build or runtime log. Don't paste keys.
