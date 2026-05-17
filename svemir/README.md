# svemir

Personal are.na — Next.js 16 + Supabase. Blocks, channels, connections, knowledge graph, Chrome extension.

## Stack

- Next.js 16 (App Router, Turbopack), TypeScript
- Tailwind CSS v4 (no config file)
- Supabase (`@supabase/supabase-js`) — anon key for reads, service-role for writes
- `open-graph-scraper` for URL metadata
- `react-force-graph-2d` for the knowledge graph
- HTTP Basic Auth on `/admin/*` via Next 16 `proxy.ts`
- Bearer-token API at `/api/v1/*` for the Chrome extension

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL, anon key, service role, admin user/pass
npm run dev                  # http://localhost:3000
```

Run the SQL in `supabase/migrations/` against your Supabase project before first start (see `PLAN.md`).

## Layout

- `app/` — routes (App Router)
- `app/page.tsx` — unified home with Channels / Blocks view toggle
- `app/block/[id]/` — block detail (full page)
- `app/@modal/(.)block/[id]/` — block detail (intercepted modal)
- `app/channel/[slug]/` — channel detail
- `app/admin/` — Basic-Auth-gated admin (add, import, manage, tokens)
- `app/api/v1/` — bearer-token API for the extension
- `components/` — view components (TopBar, FilterBar, BlocksView, ChannelsView, BlockDetail, etc.)
- `lib/` — supabase clients, types, helpers
- `proxy.ts` — Basic Auth on `/admin/*`

See `PLAN.md` for the current roadmap.
