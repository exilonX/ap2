/**
 * Widget-wide tuning constants.
 *
 * Centralized so trade-offs are visible in one place:
 *   - history length drives per-call LLM token cost
 *   - head/tail split decides what gets pinned vs sliding-window dropped
 *   - persistence TTL decides how long a conversation survives navigation
 */

/**
 * Maximum number of prior turns (user + assistant, mixed) sent in the
 * chat request `history` field. Each turn is roughly 50-200 tokens of
 * text, so 10 ≈ 1000-3000 tokens of history per call.
 *
 * Reminder: this is a client-side hint, NOT a cost ceiling. A
 * misbehaving client could send more. Server-side enforcement is
 * tracked separately.
 */
export const HISTORY_MAX_TURNS = 10

/**
 * How many turns from the START of the conversation to always keep —
 * the "anchor" that survives even after 50 messages. The opening
 * exchange usually establishes the durable intent (gender, budget,
 * occasion). Pinning it means a long session doesn't drift away from
 * the originating filter.
 *
 * Trade-off: each anchor turn is one tail turn we lose. At MAX=10 and
 * HEAD=2 we keep 2 opening + 8 recent. Lower this if the opening
 * exchange is usually low-signal in your store.
 */
export const HISTORY_HEAD_TURNS = 2

/**
 * Lifetime of a persisted conversation in localStorage. A user who
 * clicks a product card, navigates away, and comes back within the
 * window keeps their chat history. Beyond that, treat as a new session.
 */
export const CONVERSATION_TTL_MS = 60 * 60 * 1000 // 1 hour
