# Drift — The Store That Comes to You

A mobile boat-based convenience store app: live vessel tracking, on-demand hailing, order-ahead with boat-side delivery, a crowd-sourced fishing feed, and an owner dashboard for managing the onboard catalog — all backed by a live Supabase database.

This is a static site (no build step) with a Supabase backend. Two things to set up: the database, then the hosting.

---

## 1. Set up Supabase (the backend)

1. Go to [supabase.com](https://supabase.com), create a free account, and create a new project.
2. Once it's provisioned, open the **SQL Editor** and paste in the entire contents of [`supabase/schema.sql`](supabase/schema.sql), then run it. This creates the `products`, `boat_status`, `catches`, and `orders` tables, sets up row-level security, turns on realtime, and seeds a starter catalog.
3. Go to **Project Settings → API**. Copy your **Project URL** and your **anon / public key**.
4. Open `config.js` in this repo and paste them in:
   ```js
   const SUPABASE_URL = "https://your-project.supabase.co";
   const SUPABASE_ANON_KEY = "your-anon-key";
   ```
5. Create your owner login: go to **Authentication → Users → Add user**, and create a user with your email and a password. This is what you'll sign in with under "Owner View" in the app to manage products and move the boat.

That's the whole backend. No servers to run — Supabase hosts the database, auth, and realtime layer.

---

## 2. Deploy to GitHub Pages (the hosting)

1. Create a new GitHub repository (e.g. `drift`) under your account.
2. Push this folder's contents to it:
   ```bash
   git init
   git add .
   git commit -m "Initial Drift app"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/drift.git
   git push -u origin main
   ```
3. In the repo on GitHub, go to **Settings → Pages**, and under "Build and deployment" set **Source** to **GitHub Actions**. The included workflow (`.github/workflows/deploy.yml`) will pick it up automatically on your next push.
4. After the Actions run finishes (check the **Actions** tab), your app is live at `https://YOUR_USERNAME.github.io/drift/`.

Every time you push a change to `main`, it redeploys automatically — same pattern as your Angr repo.

---

## 3. Using it

- **Customers** open the URL, tap **Set my location** on the Track tab (uses their device GPS), and can hail the boat, order ahead, or log a catch — no login needed.
- **You (the owner)** tap **OWNER VIEW** in the top right, sign in with the email/password you created in Supabase Auth, and get the **Manage** tab: edit prices, add or remove products, and advance the boat's position as you actually move between stops. Every change appears on every customer's screen within a second or two via Supabase realtime — nobody needs to refresh.

---

## Notes on what's simplified for this first version

- **Boat position** is a stylized illustration, not real GPS — you advance it manually from Owner View as you move between stops. Wiring it to your phone's actual GPS is a natural next step (the `boat_status` table already has room for real lat/lng if you want to add that).
- **Delivery order status** (`placed → assigned → en_route → delivered`) currently advances automatically on a timer after an order is placed, since there's no separate crew app yet. Once you're running real deliveries, that's the first thing worth replacing with a real "mark delivered" button for whoever's running the order.
- **Order updates are open to the public** in the current database rules, which is fine for a single-boat MVP but should be tightened (e.g., requiring a customer session) before this scales past you personally checking each order.
- **Membership tiers** on the Account tab are illustrative — there's no real billing wired up yet (Stripe would be the natural next step).

None of these are hard blockers to using it for real customers on the water — they're just the honest list of "next" rather than "done."
