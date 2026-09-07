-- ============================================================
-- DRIFT — Supabase schema
-- Run this once in the Supabase SQL Editor for your project.
-- ============================================================

-- PRODUCTS: the onboard catalog (what the owner manages in Owner View)
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  category text not null,           -- 'ice' | 'bait' | 'food' | 'supplies'
  name text not null,
  price numeric(10,2) not null,
  created_at timestamptz not null default now()
);

-- BOAT_STATUS: a single row (id = 1) tracking where Drift One is right now
create table if not exists boat_status (
  id int primary key default 1,
  route_index int not null default 0,   -- index into the app's ROUTE array
  hailed boolean not null default false,
  hail_note text,                       -- free-text location the customer typed/dropped
  eta_minutes int not null default 22,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);
insert into boat_status (id) values (1) on conflict (id) do nothing;

-- CATCHES: the crowd-sourced fishing feed (this is the Angr-style integration point —
-- point this at Angr's own table/view instead if you want one shared feed)
create table if not exists catches (
  id uuid primary key default gen_random_uuid(),
  species text not null,
  bait text not null,
  spot text not null,
  source text not null default 'drift',   -- 'drift' | 'angr'
  logged_at timestamptz not null default now()
);

-- ORDERS: boat-side delivery requests placed from the Shop tab
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  items jsonb not null,
  total numeric(10,2) not null,
  location_note text,
  status text not null default 'placed',  -- placed | assigned | en_route | delivered
  created_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- MVP posture: anyone can read everything (it's a public storefront),
-- and anyone can place an order or log a catch (that's the point).
-- Only a signed-in owner account can add/edit/delete products or
-- move the boat. Tighten `orders` further once you add per-customer
-- accounts — right now anyone with an order id can update its status,
-- which is fine for a single-boat MVP but not for scale.
-- ============================================================

alter table products enable row level security;
alter table boat_status enable row level security;
alter table catches enable row level security;
alter table orders enable row level security;

create policy "public read products" on products for select using (true);
create policy "owner writes products" on products for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "public read boat_status" on boat_status for select using (true);
create policy "owner writes boat_status" on boat_status for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "public read catches" on catches for select using (true);
create policy "public log catches" on catches for insert with check (true);

create policy "public read orders" on orders for select using (true);
create policy "public create orders" on orders for insert with check (true);
create policy "public update orders" on orders for update using (true);

-- ============================================================
-- REALTIME — so every customer's Track tab updates the instant
-- the owner moves the boat or a hail comes in, no refresh needed.
-- ============================================================
alter publication supabase_realtime add table boat_status;
alter publication supabase_realtime add table products;
alter publication supabase_realtime add table catches;
alter publication supabase_realtime add table orders;

-- ============================================================
-- SEED DATA — starter catalog and a couple of sample catches
-- ============================================================
insert into products (category, name, price) values
  ('ice', '20lb Bag — Cubed', 6.00),
  ('ice', 'Cooler Fill (up to 100qt)', 14.00),
  ('ice', 'Block Ice', 5.00),
  ('bait', 'Live Shrimp (dozen)', 9.00),
  ('bait', 'Frozen Mullet', 7.00),
  ('bait', 'Replacement Hook Pack', 4.00),
  ('food', 'Dockside Club Sandwich', 11.00),
  ('food', 'Seafood Basket', 16.00),
  ('food', 'Cold Brew Coffee', 5.00),
  ('supplies', 'Sunscreen SPF50', 8.00),
  ('supplies', 'Dock Line, 15ft', 13.00),
  ('supplies', 'Waterproof Phone Pouch', 7.00);

insert into catches (species, bait, spot, source) values
  ('Redfish', 'Live shrimp', 'North Flats', 'drift'),
  ('Speckled Trout', 'Topwater lure', 'Sunset Cove', 'drift'),
  ('Flounder', 'Mud minnow', 'Grass Line', 'drift');
