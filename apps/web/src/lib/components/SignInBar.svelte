<script lang="ts">
  import type { SessionState } from "$lib/session.svelte.ts";

  /**
   * Signing in is step THREE of the journey, not step one. The board is
   * browsable first, so by the time this is pressed the visitor already knows
   * what they are signing up for.
   */
  let {
    state,
    canSignIn,
    onSignIn,
    onSignOut,
  }: {
    state: SessionState;
    canSignIn: boolean;
    onSignIn: () => void;
    onSignOut: () => void;
  } = $props();
</script>

<div class="flex items-center gap-[var(--space-3)]" style="margin-top: var(--space-4)">
  {#if state.status === "loading"}
    <span class="type-caption">…</span>
  {:else if state.status === "signed-out"}
    <button
      type="button"
      disabled={!canSignIn}
      onclick={onSignIn}
      class="rounded-[var(--radius-control)] px-[var(--space-4)] py-[var(--space-2)] font-semibold"
      style="background: var(--primary); color: var(--primary-ink)"
    >
      Sign in to queue
    </button>
    <span class="type-caption">The board is live whether you sign in or not.</span>
  {:else if state.status === "unavailable"}
    <!-- Never blank the board for this. Anonymous browsing is the proof
         surface and needs no session at all. -->
    <span class="type-caption">Sign-in is unavailable right now. The board is still live.</span>
  {:else}
    <button type="button" class="type-caption underline" onclick={onSignOut}>Sign out</button>
  {/if}
</div>
