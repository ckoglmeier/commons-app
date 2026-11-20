# Security

## Reporting a problem

Please report security problems privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue.

Include what you found, how to reproduce it, and what someone could do with it. You'll get an acknowledgment within a week. Please give a reasonable time to fix the problem before you share details publicly.

## Scope

This covers the code in this repository. Each copy of Commons is run by whoever deployed it; problems with a particular copy's settings, data or accounts go to the person who runs that copy.

## Running your own copy safely

- Keep the Supabase secret key, `CRON_SECRET` and any provider keys in your Vercel settings only. Never commit them or expose them as `NEXT_PUBLIC_*` settings.
- Keep **Who can join** on invited people only unless you mean to open your copy to others.
- Update your copy when security fixes are released (see `docs/self-hosting.md`).
