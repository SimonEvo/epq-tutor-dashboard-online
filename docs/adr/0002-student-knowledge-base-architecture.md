# ADR 0002: Student Knowledge Base — Three-Layer Architecture with Server-Side Context Assembly

**Status:** Accepted
**Date:** 2026-07-06

## Context

The tutor plans lessons by manually pasting a student's background into a web AI chat. This is painful in three ranked ways: (a) re-assembling context every time (worst), (b) insights from a chat are lost when a new chat starts, (c) student information is scattered across the system, WeChat, and the tutor's memory.

We want to bring this into the app as a per-student, tutor-only knowledge base the tutor can chat with. Full domain terms live in `CONTEXT.md` (Student Knowledge Base / Knowledge Entry); the implementation task book is `docs/projects/student-knowledge-base.md`.

Two design questions were genuinely open and hard to reverse once tables and data flows exist:
1. How is the durable "understanding" of a student stored?
2. Where is the AI prompt built and where does name-anonymization happen?

## Decision

### 1. Three layers, not a single blob

- **Layer 1 — auto-assembled structured context:** rebuilt from the DB on every chat, never cached; a full dump (the API model supports a very large context window). Which sources are pulled is a per-tutor global toggle set.
- **Layer 2 — Living Summary:** one evolving, AI-maintained, tutor-editable text per student; the main backdrop of every chat. This is the automated form of the tutor's existing "summarize → open a fresh chat" habit.
- **Layer 3 — Raw layer:** an append-only inbox of undigested scraps per student (manual notes, WeChat excerpts, AI-proposed facts). Writing touches no AI; friction is deliberately near-zero.
- **Digest action** folds Layer 3 + chat insights into Layer 2 on tutor approval, then archives the raw entries.

### 2. Context assembly + name encoding move server-side

A backend endpoint assembles Layer 1, applies AI Name Encoding, and includes `privateNotes`, returning the block to the client. The existing encode/decode logic (currently client-side TypeScript in `claudeService.ts`) is ported to Python so encoding and the privateNotes exception live in one place.

### 3. privateNotes second exception

`privateNotes` may enter the KB context because KB output is tutor-only and never reaches parents — the second explicit exception to "privateNotes never in exports" (the first is the monthly-meeting AI draft). Parent-facing reports (Session/Progress Report) are unchanged and still filter it.

## Alternatives Considered

**Single evolving blob (like a beefed-up `privateNotes`).** Matches the tutor's habit most directly and is simplest, but conflates low-friction capture with the curated base: every scrap would have to be merged immediately (breaks flow mid-class), or the blob grows into the same unmanaged mess the tutor already dislikes. Rejected in favor of separating capture (Layer 3) from the curated base (Layer 2).

**Append-only atomic facts only (no Living Summary).** Clean capture, but the durable layer then grows unbounded and just relocates the "context too long" problem the tutor solves today by summarizing. Rejected.

**Persistent chat threads.** Would let the tutor re-read old conversations, but threads grow long and messy (the tutor's own stated concern) and mix durable facts with throwaway Q&A. Rejected: chat is ephemeral; only Layers 2/3 persist.

**Client-side prompt assembly + encoding (the existing pattern).** Reuses tested TS functions and avoids a Python port. Rejected because KB is the largest data-to-AI surface in the system; centralizing encoding and the privateNotes exception server-side reduces the risk of the two AI paths (monthly meeting vs KB) drifting and of privateNotes leaking through an un-encoded path.

## Consequences

- New tables: `student_living_summaries`, `student_knowledge_entries`. New endpoints for context assembly, summary read/write/merge, entries CRUD, digest, and multi-turn chat.
- The single-shot `POST /api/ai/proxy` must gain a multi-turn variant (accept a `messages` array). Default model changes from `qwen-plus` to `deepseek-v4`.
- Encode/decode logic now exists in two languages (TS + Python) until the client path is retired; they must be kept behaviorally identical.
- Chat is not persisted; losing a conversation loses only the transcript, never the distilled Living Summary or entries.
- A cross-student "global assistant" is deferred; the 1M-context assumption is only load-bearing for that future phase, not for single-student use.
