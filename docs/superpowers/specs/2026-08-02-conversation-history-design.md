# Conversation History — Design

**Date:** 2026-08-02
**Status:** Approved, pending implementation
**Branch:** `alert-center`

## Problem

The sidebar's **History** section is fake. `src/components/layout/use-chat-recents.ts`
seeds ten hardcoded titles into `localStorage` under `composer-chat-recents`, and
`ChatRecents.tsx` renders them as `<button>` elements with no click handler. Nothing
can be opened.

Two things are missing, not one:

1. **History stores titles, not transcripts.** The code says so directly — a comment in
   `src/app/chat/page.tsx` notes "addChatRecent only stores a title, so the transcript
   itself is gone."
2. **The chat itself never persists.** `messages` lives in React state in
   `src/app/chat/page.tsx:138`. Navigating away discards the conversation.
3. **Even the title is only recorded on exit.** `addChatRecent` is called from exactly two
   places — `endSession` (`page.tsx:341`) and `switchMode` (`page.tsx:365`). A conversation
   never appears in History while it is happening, only once it is closed with the × chip
   or the mode is switched. This is the symptom users hit first: start a new chat, look
   left, see nothing.

So even wiring up a click handler today would open nothing. All three layers need work.

A related cosmetic bug: each row renders a status dot chosen by list position —
`index === 1` green, `index === 3` red, `index === 5` a spinning amber ring. These
communicate nothing, and read as ten "pending" items.

## Goal

Conversations persist to the shared Supabase database and behave like any normal chat
sidebar: click a past conversation, see the full transcript, keep typing.

## Decisions

| Question | Decision |
|---|---|
| Which chats persist | All non-case chats: `chat`, `alert`, `report`. Cases keep their own sidebar list and are not double-listed. |
| Row status dots | Removed. Rows become title-only. |
| Visibility | Private to the signed-in user. |
| Attachment bytes | Not stored. Metadata only (`name`, `type`, `size`). |
| Surfaces | Main `/chat` page only. The canvas panel keeps its sessionStorage behavior. |
| Rich cards on reopen | Inert but visible — see "Rich cards" below. |

### Correction: there are two chat surfaces, with different message types

An earlier revision of this document assumed the `ChatMessage` type in
`src/components/ai-chat/types.ts`. That was wrong. The app has two independent chat stores:

1. **`src/app/chat/page.tsx`** keeps its own local `Msg` type (`page.tsx:48-77`) in React
   state. This is the surface the sidebar's History reflects, and the only one in scope.
2. **`src/components/ai-chat/AiChatContext.tsx`** keeps a separate `ChatMessage[]` in
   `sessionStorage` under `composer-chat-messages`. It backs `CanvasChatPanel` and
   `PageDrawer`. Out of scope; unchanged.

The `/chat` page imports `useChat()` only for canvas and reference plumbing
(`openCanvas`, `pendingReferences`), never for messages.

`Msg` is considerably richer than `ChatMessage`. Beyond `content` and `references` it
carries `holdingsExport`, `txnExport`, `txnPrompt`, `symbolReport`, `proposedReport`,
`reportSaved`, `proposedAlert`, `alertSaved`, and `reportData`.

### Rich cards on reopen

Those extra fields drive live interactive UI — "Download Excel" chips, alert and report
confirm-cards, in-chat data tables. Restored conversations render them **inert but
visible**: tables and report data still display so the transcript reads correctly, while
download chips and confirm-cards appear in a historical, non-actionable state.

Fully re-arming them would be wrong on two counts. Export file bytes are not stored, so a
download chip could not produce a file; and a live confirm-card would let the user create a
second alert from a proposal they already accepted.

### Why Supabase, and why new tables

Supabase is right, and the codebase already contains a working precedent: `cases` +
`case_messages` (migration `0002_case_workspace.sql`) is the same shape — a conversation
with an ordered message thread.

Reusing those tables with a `kind` discriminator was considered and rejected. Cases are
shared across the firm and carry participants, documents, and a realtime publication.
History is private and has none of those. Merging them would mean filtering two products
apart at every call site and would make the Cases feature harder to change later.

Keeping localStorage and merely adding transcripts was also rejected: it is per-browser,
so history would vanish on another machine. That is what the feature already is, and why
it feels fake.

## Data model

New migration: `supabase/migrations/0007_conversations.sql`.

Follows the reseed-proof convention established by `0002`: text primary keys, no foreign
keys into seeded tables (`Account`, `User` get fresh CUIDs on every `npm run db:seed`).

```sql
CREATE TABLE public.conversations (
  id               text PRIMARY KEY,
  title            text NOT NULL,
  kind             text NOT NULL DEFAULT 'chat'
                   CHECK (kind IN ('chat','alert','report')),
  pinned           boolean NOT NULL DEFAULT false,
  account_number   text,
  account_name     text,
  household_name   text,
  created_by       text NOT NULL,
  created_by_name  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversations_owner_updated_idx
  ON public.conversations (created_by, updated_at DESC);

CREATE TABLE public.conversation_messages (
  id               text PRIMARY KEY,
  conversation_id  text NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  seq              integer NOT NULL,
  role             text NOT NULL CHECK (role IN ('user','assistant')),
  content          text NOT NULL,
  refs             jsonb,
  card             jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX conversation_messages_conv_seq_idx
  ON public.conversation_messages (conversation_id, seq);
```

Notes on specific columns:

- **`refs`, not `references`.** `REFERENCES` is a reserved word in PostgreSQL. This column
  holds the `ChatReference[]` from `src/components/ai-chat/types.ts`.
- **`seq`** gives a stable render order independent of timestamp collisions. Unique per
  conversation.
- **`account_number` / `account_name` / `household_name`** store the scope the user had
  set, so reopening restores context rather than just words.
- **`card`** is one discriminated-union column rather than a column per card type. The
  `Msg` card variants are mutually exclusive, and adding a new one should not require a
  migration:

  ```ts
  type StoredCard =
    | { type: "reportData";     data: ReportData }
    | { type: "symbolReport";   data: SymbolHoldingsResult }
    | { type: "proposedReport"; data: ProposedReport; saved: boolean }
    | { type: "proposedAlert";  data: ProposedAlert;  saved: boolean }
    | { type: "export";         kind: "holdings" | "transactions"; label: string };
  ```

  `holdingsExport` and `txnExport` collapse to `{ type: "export" }` carrying a label only —
  the file bytes are deliberately dropped, since writing them into table rows would bloat
  the table and the download could not work later regardless. `txnPrompt` is transient UI
  and is not stored.

Attachments are likewise metadata-only where they appear; `ChatAttachment.content` (base64)
is never written. Storing bytes properly would need a storage bucket, which is out of scope.

RLS is enabled with permissive policies, matching the rest of the schema — access goes
through the API routes, which scope every query to the current user.

**No realtime publication.** Unlike `cases`, history is single-user; there is no second
client to sync.

## API

New routes under `src/app/api/conversations/`, following the `src/app/api/cases/route.ts`
pattern (`requireAuth`, then `supabase` client, `NextResponse.json({ data })`).

| Route | Purpose |
|---|---|
| `GET /api/conversations` | List mine, `created_by = session.userId`, `updated_at DESC` |
| `POST /api/conversations` | Create; returns the new id |
| `GET /api/conversations/[id]` | Conversation plus its messages, ordered by `seq` |
| `PATCH /api/conversations/[id]` | Rename, pin, unpin |
| `DELETE /api/conversations/[id]` | Delete; messages cascade |
| `POST /api/conversations/[id]/messages` | Append a batch of messages |

**Every `[id]` route must verify ownership**, not just authentication. A valid session for
user A must not be able to read, mutate, or delete user B's conversation by guessing an
id. `requireAuth` alone does not provide this.

Input caps follow the existing cases route: title trimmed and capped at 80 characters,
account/household strings capped as they are today.

Rate limiting via `enforceRateLimit` on the write routes.

## Client changes

### `use-chat-recents.ts` — rewritten

Talks to the API instead of `localStorage`, but **keeps the same hook signature**:

```ts
{ recents, pin, unpin, rename, remove }
```

Because the shape is unchanged, `ChatRecents.tsx` and `Sidebar.tsx` need almost no edits
and the sidebar looks and behaves exactly as it does now. That was an explicit
requirement: the bar's current behavior is the target, only the data behind it changes.

- `SEED_TITLES` and the seeding logic are deleted.
- The existing `"No recent chats."` empty state takes over for new users.
- The stale `composer-chat-recents` localStorage key is removed on first load so old dummy
  rows do not linger in anyone's browser.
- `ChatRecent` gains `kind` and the fields needed to open a conversation.

### `ChatRecents.tsx`

- Rows become clickable, navigating to `/chat?c=<id>`.
- The index-based dot logic (`index === 1 | 3 | 5`) is deleted entirely.
- Pin / rename / delete keep working; they now call the API through the hook.

### `src/app/chat/page.tsx`

- On first user send, create the conversation row. Title = first user message, capped at
  80 characters (the rule already in `addChatRecent`).
- Append messages as each turn completes, tracked by a `Set` of already-persisted message
  ids. Append-only; no full-list rewrites.
- On mount, read `?c=<id>`; if present, fetch and hydrate `messages`, `createKind`, and the
  picked account/household. Continuing the chat appends to the same conversation.
- Remove the `addChatRecent` calls in `endSession` and `switchMode`. By the time either
  runs the conversation already exists; leaving them would create duplicate title-only rows.
- Render restored cards inert: disabled export chips, confirm-cards in their saved state.
- `/chat` needs a `Suspense` boundary for `useSearchParams`, the way `src/app/create/page.tsx`
  already wraps `ChatPage`.

### `SearchOverlay` ("Sessions" mode)

`Sidebar.tsx` currently passes `chatRecents.map((r) => r.title)` — bare strings. It needs
ids alongside titles so a search result can open its conversation.

## Failure behavior

Persistence is **best-effort and silent**. If Supabase is unreachable, the chat still
sends, renders, and works; the failed write is logged to the console and dropped. A
history feature must never cost someone a live conversation.

This matches the posture documented for `src/lib/market/` — never surface a backend
failure into the UI.

## Verification

- `npm run typecheck`
- Playwright: send a message → reload → click the History row → assert the transcript is restored
- Playwright: pin, rename, and delete each survive a reload
- Ownership: a request for another user's conversation id returns **404**, not data and not
  403 — a 403 would confirm that the id exists
- The standing pre-commit checks in `CLAUDE.md` pass.

## Operational notes

- The migration is applied **by hand in the Supabase SQL editor**. Per the standing rules,
  `prisma migrate` is never run against this database.
- This is the **shared live database**. These are new tables, so nothing collides with
  existing data.
- No Prisma schema change. `conversations` is an app-level table like `cases`, `alerts`,
  and `saved_reports`, none of which appear in `prisma/schema.prisma`.

## Out of scope

- Storing attachment file bytes (needs a storage bucket)
- Sharing conversations between users
- Folders, tags, or search within a transcript
- Realtime sync across devices
- Migrating the ten existing dummy titles — they are placeholder text and are discarded
