<script lang="ts">
  import {
    MAX_PAIRS_PER_ACCOUNT,
    REFINEMENTS,
    relicBucketKey,
    searchRelics,
    type BucketKey,
    type Refinement,
    type Relic,
  } from "@radshare/protocol";
  import TierBadge from "./TierBadge.svelte";

  /**
   * The selection is a CROSS PRODUCT: three relics against two refinements is
   * six buckets. That is why the counter reads pairs — someone counting relics
   * hits the cap without understanding why.
   *
   * Radiant is preselected because it is what radsharing means.
   */
  let {
    queued,
    queuedCount,
    disabled = false,
    onQueue,
    onLeave,
  }: {
    queued: boolean;
    /** From the server's `you`, not local state: a refresh loses the chips. */
    queuedCount: number;
    disabled?: boolean;
    onQueue: (selection: BucketKey[]) => void;
    onLeave: () => void;
  } = $props();

  let query = $state("");
  let chosen = $state<Relic[]>([]);
  let refinements = $state<Refinement[]>(["radiant"]);

  let results = $derived(query.trim() === "" ? [] : searchRelics(query, 8));
  let chosenIds = $derived(new Set(chosen.map((r) => r.id)));

  let selection = $derived(
    chosen.flatMap((relic) => refinements.map((r) => relicBucketKey(relic.id, r))),
  );
  let overCap = $derived(selection.length > MAX_PAIRS_PER_ACCOUNT);

  function add(relic: Relic) {
    if (chosenIds.has(relic.id)) return;
    chosen = [...chosen, relic];
    query = "";
  }

  function remove(id: string) {
    chosen = chosen.filter((r) => r.id !== id);
  }

  function toggleRefinement(r: Refinement) {
    refinements = refinements.includes(r)
      ? refinements.filter((x) => x !== r)
      : [...refinements, r];
  }
</script>

<section>
  <h2 class="type-label" id="composer-label">Queue composer</h2>

  {#if queued}
    <!-- While queued the board IS your buckets, so this steps back. -->
    <div class="flex items-center gap-[var(--space-4)]">
      <p class="type-body">
        Queued for {queuedCount}
        {queuedCount === 1 ? "bucket" : "buckets"}. Keep this tab open.
      </p>
      <button
        type="button"
        class="type-caption rounded-[var(--radius-control)] border px-[var(--space-3)] py-[var(--space-2)]"
        style="border-color: var(--border-strong)"
        onclick={onLeave}
      >
        Leave queue
      </button>
    </div>
  {:else}
    <label class="type-caption block" for="relic-search">Find a relic</label>
    <input
      id="relic-search"
      type="text"
      autocomplete="off"
      bind:value={query}
      placeholder="axi a1"
      class="type-data w-full rounded-[var(--radius-control)] border px-[var(--space-3)] py-[var(--space-2)]"
      style="background: var(--surface); border-color: var(--border-strong); color: var(--text)"
    />

    {#if query.trim() !== ""}
      {#if results.length === 0}
<!-- Name the query back; a stale list is worse than nothing. -->
        <p class="type-caption" style="padding-top: var(--space-2)">
          No relic matches “{query}”.
          <button type="button" class="underline" onclick={() => (query = "")}>Clear</button>
        </p>
      {:else}
        <ul style="list-style: none; padding: 0; margin: var(--space-2) 0">
          {#each results as relic (relic.id)}
            <li>
              <button
                type="button"
                class="flex h-[var(--row-height)] w-full items-center gap-[var(--space-2)] px-[var(--space-2)] text-left"
                style="background: {chosenIds.has(relic.id) ? 'var(--surface-raised)' : 'transparent'}"
                onclick={() => add(relic)}
              >
                <TierBadge tier={relic.tier} />
                <span class="type-data">{relic.name}</span>
                {#if relic.vaulted}
                  <!-- The wedge: the relics recruiting chat cannot fill. -->
                  <span class="type-caption" style="color: var(--text-secondary)">vaulted</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

    {#if chosen.length > 0}
      <ul
        class="flex flex-wrap gap-[var(--space-2)]"
        style="list-style: none; padding: 0; margin: var(--space-4) 0"
      >
        {#each chosen as relic (relic.id)}
          <li>
            <span
              class="type-data inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-control)] border px-[var(--space-2)] py-[var(--space-1)]"
              style="border-color: var(--border-strong)"
            >
              {relic.name}
              <button
                type="button"
                aria-label="Remove {relic.name}"
                onclick={() => remove(relic.id)}
                style="color: var(--text-secondary)">×</button
              >
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    <fieldset style="border: 0; padding: 0; margin: var(--space-4) 0">
      <legend class="type-caption">Refinement</legend>
      <div class="flex flex-wrap gap-[var(--space-2)]" style="margin-top: var(--space-2)">
        {#each REFINEMENTS as refinement (refinement)}
          <label
            class="type-caption inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-control)] border px-[var(--space-3)] py-[var(--space-1)]"
            style="border-color: {refinements.includes(refinement)
              ? 'var(--primary)'
              : 'var(--border)'}; color: {refinements.includes(refinement)
              ? 'var(--primary)'
              : 'var(--text-secondary)'}"
          >
            <input
              type="checkbox"
              checked={refinements.includes(refinement)}
              onchange={() => toggleRefinement(refinement)}
            />
            {refinement}
          </label>
        {/each}
      </div>
    </fieldset>

    <div class="flex items-center gap-[var(--space-4)]">
      <button
        type="button"
        disabled={disabled || selection.length === 0 || overCap}
        onclick={() => onQueue(selection)}
        class="rounded-[var(--radius-control)] px-[var(--space-6)] py-[var(--space-3)] font-semibold"
        style="background: {selection.length === 0 || overCap
          ? 'var(--surface-raised)'
          : 'var(--primary)'}; color: {selection.length === 0 || overCap
          ? 'var(--text-tertiary)'
          : 'var(--primary-ink)'}"
      >
        Queue
      </button>

      <span class="type-data" style="color: var(--text-secondary)">
        {selection.length}/{MAX_PAIRS_PER_ACCOUNT}
      </span>

      {#if selection.length === 0}
        <span class="type-caption">Pick at least one relic.</span>
      {:else if overCap}
        <!-- Inline, never a modal. The server rejects the whole message too. -->
        <span class="type-caption" style="color: var(--danger)">
          {MAX_PAIRS_PER_ACCOUNT}/{MAX_PAIRS_PER_ACCOUNT} buckets — remove a relic or a refinement.
        </span>
      {/if}
    </div>
  {/if}
</section>
