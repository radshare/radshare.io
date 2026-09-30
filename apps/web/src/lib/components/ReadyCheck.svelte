<script lang="ts">
  import type { ReadyGateState } from "$lib/connection.ts";
  import { labelFor, refinementLabel } from "$lib/relics.ts";
  import TierBadge from "./TierBadge.svelte";

  /**
   * The pre-lobby confirmation: a bucket reaching four opens this, and the
   * lobby exists only once all four confirm.
   *
   * It sits over the board, so it carries the app's one offset shadow. Offset
   * plus blur is depth; zero-offset colour is glow, and there is none.
   */
  let {
    gate,
    now,
    onConfirm,
  }: { gate: ReadyGateState; now: number; onConfirm: () => void } = $props();

  let label = $derived(labelFor(gate.bucketKey));
  let remaining = $derived(Math.max(0, Math.ceil((gate.deadlineAt - now) / 1000)));
  let confirmedCount = $derived(gate.members.filter((m) => m.confirmed).length);
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center p-[var(--space-4)]"
  style="background: rgb(0 0 0 / 0.6)"
>
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Squad found"
    class="w-full max-w-[420px] rounded-[var(--radius-panel)] border p-[var(--space-6)]"
    style="background: var(--surface); border-color: var(--border-strong); box-shadow: var(--shadow-overlay)"
  >
    <div class="flex items-center gap-[var(--space-2)]">
      <TierBadge tier={label.tier} />
      <span class="type-heading font-mono">{label.name}</span>
      <span class="type-caption">{refinementLabel(label.refinement)}</span>
    </div>

    <p class="type-body" style="margin: var(--space-4) 0 var(--space-2)">
      Squad found. Confirm within
      <span class="type-data" style="color: var(--primary)">{remaining}s</span>
      or the match is cancelled.
    </p>

    <ul style="margin: var(--space-4) 0; list-style: none; padding: 0">
      {#each gate.members as member (member.accountId)}
        <li
          class="flex h-[var(--row-height)] items-center justify-between border-b"
          style="border-color: var(--border)"
        >
          <span class="type-data">Tenno {member.accountId.slice(0, 6)}</span>
          <!-- Never colour alone. -->
          {#if member.confirmed}
            <span class="type-caption font-semibold" style="color: var(--ready)">READY</span>
          {:else}
            <span class="type-caption" style="color: var(--text-tertiary)">waiting</span>
          {/if}
        </li>
      {/each}
    </ul>

    <button
      type="button"
      onclick={onConfirm}
      disabled={gate.confirmed}
      class="w-full rounded-[var(--radius-control)] py-[var(--space-3)] font-semibold"
      style="background: {gate.confirmed
        ? 'var(--surface-raised)'
        : 'var(--primary)'}; color: {gate.confirmed ? 'var(--text-secondary)' : 'var(--primary-ink)'}"
    >
      {gate.confirmed ? `Waiting for ${4 - confirmedCount} more` : "I'm ready"}
    </button>
  </div>
</div>
