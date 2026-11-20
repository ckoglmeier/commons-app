# Deploy Commons with an AI assistant

This guide is written so you can hand it to an AI assistant (ChatGPT, Claude or another) and work through it together. Each step says what to do, where, and how to check it worked. It reaches the same result as the Deploy button in the README: your own copy of Commons on your own Vercel account, on free plans.

You stay in control. The assistant explains each step and waits for you. It never asks for your passwords. You paste a few values between dashboards yourself.

After you deploy, [Self-hosting](self-hosting.md) covers settings, your own domain, updates, backups and troubleshooting.

## What you'll end up with

- A Commons site at a `vercel.app` address, or your own domain.
- A Supabase project holding the database, sign-in and private photos.
- Optional: Resend sending sign-in links, invitations and new-message notices. Without it, people sign in with a password.
- You as the instance admin: the first account to sign in.

## Costs and limits on free plans

| Service | Free plan limit that matters | What happens at the limit |
| --- | --- | --- |
| Vercel Hobby | Non-commercial use only; scheduled jobs run at most once a day | Commons's one daily job fits. Use a paid plan for commercial use. |
| Supabase Free | Projects pause after about a week with no activity; 500 MB database | Commons's daily job keeps the project awake. See "If Supabase paused your project". |
| Resend Free | 100 emails a day, 3,000 a month; one sending domain | Resend refuses emails over the limit. Commons's daily job retries failed invitation and poll emails. |

These were checked in November 2026. Limits change, so check each provider's pricing page. Sources are in the [README](../README.md#what-it-costs).

## Before you start

You need:

1. A GitHub account.
2. A Vercel account (sign up with GitHub).
3. An email address you can receive mail at.
4. Optional but strongly recommended: a domain you control, for sending email to people other than yourself.

## Step 1: Copy the repository and create the Vercel project

1. Open the README's **Deploy** button, or go to `https://vercel.com/new` and import your copy of the Commons repository.
2. Set **Root Directory** to `apps/web`. The Deploy button does this for you.
3. When Vercel asks for environment variables, add `CRON_SECRET`. Make a value with `openssl rand -base64 32` in a terminal, or any password generator set to 40 or more characters.
4. If Vercel lets you skip the first deploy, skip it. If not, the first build may fail until Step 2 is done. That's expected.

Check: the project appears in your Vercel dashboard.

## Step 2: Add Supabase

1. In the Vercel project, open **Storage** and add **Supabase** from the Marketplace. Choose the free plan and a region near your travelers.
2. Connect it to the project for all environments.

The integration adds the database and Supabase settings. Commons reads the integration's names (`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`), so you don't copy anything by hand.

Check: **Settings → Environment Variables** lists `POSTGRES_URL` and `NEXT_PUBLIC_SUPABASE_URL`.

To create the Supabase project yourself at supabase.com instead, copy these into Vercel: the pooled connection string as `DATABASE_URL`, the direct connection string as `DATABASE_DIRECT_URL`, the project URL as `NEXT_PUBLIC_SUPABASE_URL`, the publishable (anon) key as `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the secret (service role) key as `SUPABASE_SERVICE_ROLE_KEY`.

## Step 3: Add Resend (optional)

Skip this step to run without email: people sign in with a password and you share trip invite links yourself. You can add Resend later.

1. In the Vercel project, add **Resend** from the Marketplace (or create an API key at resend.com and add it as `RESEND_API_KEY`).
2. Add `COMMONS_EMAIL_FROM`, for example `Commons <trips@yourdomain.com>`.
3. Verify your sending domain in Resend: **Domains → Add domain**, then add the DNS records Resend shows at your domain registrar. Verification usually takes a few minutes and can take longer.

Until the domain is verified, Resend only delivers to the address you signed up to Resend with. You can still sign in yourself and look around; invitations to other people will wait.

Check: Resend shows the domain as **Verified**.

## Step 4: Deploy

1. In Vercel, open **Deployments** and redeploy (or push any commit).
2. The build runs the database migrations, so a fresh database builds itself.

Check: the deployment succeeds and the site opens. If the build fails, see "If the first deployment fails".

## Step 5: Become the instance admin

1. Open your site and choose **Sign in**. Enter your email.
2. With Resend: open the link in the email. Without email: choose **Create account** and pick a password.

The first account to sign in becomes the instance admin. By default, only people invited to a trip can create an account. To change that, open **Who can join** from your account menu and choose:

- **Invited people only** (default): people join when someone invites them to a trip.
- **People at these email domains**: anyone with an email at the domains you list.
- **Anyone with the link**: anyone who finds your site.

Travelers you invite never see this choice. They follow their invitation and join.

Check: your account menu shows **Who can join**.

## Step 6: Try it

1. Create a trip.
2. Invite yourself at a second address, or a friend.
3. Open the invitation, join, and open **Messages** to see the welcome from Commons.

## Optional: your own domain

A `vercel.app` address works. To use your own, add it under **Settings → Domains** in Vercel, then set `NEXT_PUBLIC_SITE_URL` to `https://` plus that domain and redeploy. Sign-in links and invitations use this address.

## Optional services

Each one stays off and hidden until its settings exist. Add them in Vercel and redeploy.

- **AI help writing polls:** `OPENAI_API_KEY`.
- **Product analytics:** `NEXT_PUBLIC_POSTHOG_KEY` (and `NEXT_PUBLIC_POSTHOG_HOST` if you're not on PostHog's US cloud). Session replay stays off unless you set `NEXT_PUBLIC_POSTHOG_REPLAY=true`.
- **Texting:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_MESSAGING_SERVICE_SID`, with a verified toll-free number in Twilio. Messages with Commons works without texting.
- **Your terms and privacy details:** `COMMONS_INSTANCE_OWNER_NAME`, `COMMONS_INSTANCE_CONTACT_EMAIL` and `COMMONS_INSTANCE_JURISDICTION`, or `COMMONS_TERMS_URL` and `COMMONS_PRIVACY_URL` to link to your own pages.

## If the first deployment fails

- **Missing database settings:** finish Step 2, then redeploy.
- **Migration error:** open the build log and look for the first line that mentions a migration. A brand new Supabase project should migrate cleanly; if you reused a database, start with an empty one.
- **Emails don't arrive:** check Resend's **Logs**. An unverified domain only delivers to your own address.

## If Supabase paused your project

See also [Self-hosting](self-hosting.md#if-supabase-paused-your-project).

Free Supabase projects pause after about a week without activity. Commons's daily job makes one small database request to prevent that, but a project can still pause if the job stopped running (for example, if `CRON_SECRET` is missing).

To restore it:

1. Open the Supabase dashboard and select the project. A paused project shows a **Restore project** button.
2. Choose **Restore** and wait until the project shows as active, usually a few minutes.
3. Open your Commons site. Nothing needs redeploying, and your data is kept.

Check that `CRON_SECRET` is set in Vercel and that **Settings → Cron Jobs** shows the daily job running.

## Notes for the assistant

- Work one step at a time and confirm each check with the person before moving on.
- Never ask for or repeat passwords, API keys or secret values in the chat. The person pastes them into the dashboards directly.
- If a dashboard looks different from this guide, describe what to look for rather than guessing at button names.
