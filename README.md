# My Tasks – Office & Personal To-Do (PWA)

A to-do list that works on desktop and mobile (installable as an app), with
separate **Office** and **Personal** workspaces, synced through **Supabase** and
hosted free on **Netlify**.

## Features
- Office / Personal / All workspace switch
- Views: Today (incl. overdue), Upcoming, All tasks, Completed
- Priority, status (to do / in progress / done), due date and time, notes
- Categories with colors (default ones are created on first login)
- Search and sort
- Live sync between phone and desktop (Supabase Realtime)
- Installable PWA; opens offline and shows your last-synced tasks (read only)
- Email + password login; each user sees only their own tasks (Row Level Security)
- Keyboard shortcut on desktop: **N** = new task

## Project structure
```
index.html            App markup
css/styles.css        Responsive styles (sidebar on desktop, bottom tabs on mobile)
js/app.js             App logic
js/config.js          Your Supabase URL and anon key  <-- edit this
sw.js                 Service worker (offline cache)
manifest.webmanifest  PWA manifest
icons/                App icons
supabase/schema.sql   Database tables + security rules
netlify.toml          Netlify settings
```

## Setup

### 1. Create the Supabase project (free)
1. Sign up at https://supabase.com and click **New project**.
2. Open **SQL Editor -> New query**, paste all of `supabase/schema.sql`, click **Run**.
3. Open **Project Settings -> API** and copy the **Project URL** and the **anon public** key.
4. Paste them into `js/config.js`.

### 2. Try it locally
Service workers need `localhost` or HTTPS, so run a small local server:
```bash
cd /var/www/html/to-do-list
python3 -m http.server 8080
```
Open http://localhost:8080, click **Create an account**, confirm the email, then sign in.

### 3. Deploy to Netlify (free)
Option A – drag and drop: go to https://app.netlify.com/drop and drop the
`to-do-list` folder.

Option B – from GitHub (auto-deploys on every push): push this folder to a
GitHub repo, then in Netlify choose **Add new site -> Import an existing project**.
No build command is needed; the publish directory is `.`.

### 4. Tell Supabase your Netlify address
In Supabase **Authentication -> URL Configuration**, set **Site URL** to your
Netlify URL (e.g. `https://my-tasks.netlify.app`) and add it under
**Redirect URLs**. This makes the confirmation and password-reset emails link
back to your app.

### 5. Install on your phone
- **Android (Chrome):** open the site -> menu (⋮) -> **Add to Home screen / Install app**
- **iPhone (Safari):** open the site -> Share -> **Add to Home Screen**

## Updating the app
After changing files, bump `CACHE_VERSION` in `sw.js` (e.g. `v1` -> `v2`) and
redeploy, so installed apps pick up the new version.

## Notes
- The anon key in `js/config.js` is meant to be public; your data is protected
  by the Row Level Security policies in `schema.sql`.
- Supabase pauses free projects after about a week with no activity. Using the
  app regularly keeps it awake; a paused project can be restored from the dashboard.

## Ideas for next versions
Subtasks/checklists, recurring tasks, push reminders, Kanban board, swipe
gestures, offline editing with background sync.
