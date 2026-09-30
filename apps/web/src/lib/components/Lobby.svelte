<script lang="ts">
  import type { LobbyView } from "@radshare/protocol";
  import { refinementLabel } from "$lib/relics.ts";
  import { relicTier } from "@radshare/protocol";
  import TierBadge from "./TierBadge.svelte";

  /**
   * Post-match. One job: get the HOST to whisper three people.
   *
   * The asymmetry is in the DATA — a non-host's payload has no `whisper` field
   * at all, so the button cannot be rendered even by mistake.
   *
   * No READY control: everyone here confirmed at the gate, and the happy path
   * is that you read the names and abandon the browser.
   */
  let { lobby, onLeave }: { lobby: LobbyView; onLeave: () => void } = $props();

  let copied = $state<string | null>(null);

  async function copy(accountId: string, whisper: string) {
    try {
      await navigator.clipboard.writeText(whisper);
      copied = accountId;
      setTimeout(() => (copied = copied === accountId ? null : copied), 3000);
    } catch {
      copied = null; // the whisper stays selectable in the row above
    }
  }
</script>

<section>
  <div class="flex items-center gap-[var(--space-2)]" style="padding-top: var(--space-6)">
    <TierBadge tier={relicTier(lobby.bucketKey.split(":")[0] ?? "")} />
    <h1 class="type-heading font-mono">{lobby.relicName}</h1>
    <span class="type-caption">{refinementLabel(lobby.refinement)}</span>
  </div>

  <!-- Second thing read, after the relic assignment. -->
  <p
    class="type-body"
    style="background: var(--surface-raised); padding: var(--space-3) var(--space-4); margin: var(--space-4) 0"
  >
    {#if lobby.role === "host"}
      You're the host. Invite these three in Warframe.
    {:else}
      {lobby.hostIgn} will invite you. Keep Warframe open.
    {/if}
  </p>

  <table class="w-full border-collapse text-left">
    <thead>
      <tr class="type-label">
        <th scope="col" class="px-[var(--space-3)] pb-[var(--space-2)]">Tenno</th>
        <th scope="col" class="px-[var(--space-3)] pb-[var(--space-2)]">Platform</th>
        <th scope="col" class="px-[var(--space-3)] pb-[var(--space-2)]">MR</th>
        <th scope="col" class="px-[var(--space-3)] pb-[var(--space-2)]"></th>
      </tr>
    </thead>
    <tbody>
      {#each lobby.members as member (member.accountId)}
        <tr
          class="h-[var(--row-height)] border-b"
          style="border-color: var(--border); {member.hasLeft ? 'opacity: 0.5' : ''}"
        >
          <td class="type-data px-[var(--space-3)]">
            <!-- Selectable at every width: below 601px it is read and typed. -->
            <span style="user-select: text">{member.ign}</span>
            {#if member.isYou}<span class="type-caption" style="color: var(--primary)"> YOU</span>{/if}
            {#if member.isHost}<span class="type-caption"> host</span>{/if}
            {#if member.hasLeft}<span class="type-caption"> left</span>{/if}
          </td>
          <td class="type-caption px-[var(--space-3)]">{member.platform ?? ""}</td>
          <!-- Absent when unset. A courtesy signal, never a gate. -->
          <td class="type-data px-[var(--space-3)]">{member.masteryRank ?? ""}</td>
          <td class="px-[var(--space-3)] text-right">
            {#if member.whisper}
              <button
                type="button"
                class="copy-whisper type-caption rounded-[var(--radius-control)] border px-[var(--space-2)] py-[var(--space-1)]"
                style="border-color: var(--primary); color: var(--primary)"
                onclick={() => copy(member.accountId, member.whisper!)}
              >
                {copied === member.accountId ? "COPIED" : "Copy whisper"}
              </button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <p class="type-data" style="color: var(--text-secondary); margin-top: var(--space-3)">
    {lobby.whisperFormat}
  </p>

  <div class="flex items-center gap-[var(--space-4)]" style="margin-top: var(--space-6)">
    <span class="type-caption">
      Share code <span class="type-data" style="letter-spacing: 0.1em">{lobby.shareCode}</span>
    </span>
    <!-- Always available: an AFK host never presses Leave, so a button scoped
         to that case would never appear when it is needed. -->
    <button type="button" class="type-caption underline" onclick={onLeave}>Queue again</button>
  </div>
</section>

<style>
  /* A phone's clipboard cannot reach Warframe -- the game is on the PC. */
  @media (max-width: 600px) {
    .copy-whisper {
      display: none;
    }
  }
</style>
