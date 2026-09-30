<script lang="ts">
  import type { RelicTier } from "@radshare/protocol";

  /**
   * The ONLY place a tier colour appears — never a row, border, segment or
   * button.
   *
   * The label is not optional: under deuteranopia neo, meso and lith converge,
   * so the text is the information and the colour is the shortcut. Requiem and
   * Vanguard have no palette entry and render in secondary text rather than
   * borrowing a colour that means something else.
   */
  let { tier }: { tier: RelicTier | null } = $props();

  const PALETTE: Partial<Record<RelicTier, string>> = {
    axi: "var(--tier-axi)",
    neo: "var(--tier-neo)",
    meso: "var(--tier-meso)",
    lith: "var(--tier-lith)",
  };

  let colour = $derived(tier ? (PALETTE[tier] ?? "var(--text-secondary)") : null);
</script>

{#if tier && colour}
  <span
    class="inline-flex items-center rounded-[var(--radius-control)] border px-[var(--space-2)] font-mono text-[var(--text-caption)] font-semibold uppercase"
    style="color: {colour}; border-color: {colour}"
  >
    {tier}
  </span>
{/if}
