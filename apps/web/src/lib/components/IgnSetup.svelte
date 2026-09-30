<script lang="ts">
  import { IGN_MAX_LENGTH, PLATFORMS, type Platform } from "@radshare/protocol";

  /**
   * The first-run screen. Signed in with Clerk, but no account row yet.
   *
   * An in-game name is required because the product ends in a host typing it
   * into Warframe — an account without one cannot be invited. It is not
   * verified against the game, so this asks plainly rather than pretending to
   * check.
   */
  let { onSubmit }: { onSubmit: (ign: string, platform: string | null) => Promise<string | null> } =
    $props();

  let ign = $state("");
  let platform = $state<Platform | "">("");
  let error = $state<string | null>(null);
  let saving = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (saving) return;
    saving = true;
    error = await onSubmit(ign, platform === "" ? null : platform);
    saving = false;
  }
</script>

<section style="padding-top: var(--space-6)">
  <h2 class="type-label">One more thing</h2>
  <p class="type-body">
    What's your in-game name? The host of your squad will whisper it to invite you.
  </p>

  <form onsubmit={submit} style="margin-top: var(--space-4)">
    <label class="type-caption block" for="ign">In-game name</label>
    <input
      id="ign"
      type="text"
      bind:value={ign}
      maxlength={IGN_MAX_LENGTH}
      autocomplete="off"
      placeholder="zylok"
      class="type-data w-full max-w-[320px] rounded-[var(--radius-control)] border px-[var(--space-3)] py-[var(--space-2)]"
      style="background: var(--surface); border-color: var(--border-strong); color: var(--text)"
    />
    <!-- Warframe names are plain. Any mockup showing zylok#314 is wrong. -->
    <p class="type-caption">Exactly as it appears in Warframe. No numbers after it.</p>

    <label class="type-caption block" for="platform" style="margin-top: var(--space-3)">
      Platform (optional)
    </label>
    <select
      id="platform"
      bind:value={platform}
      class="type-caption rounded-[var(--radius-control)] border px-[var(--space-2)] py-[var(--space-1)]"
      style="background: var(--surface); border-color: var(--border-strong); color: var(--text)"
    >
      <option value="">Not saying</option>
      {#each PLATFORMS as p (p)}
        <option value={p}>{p}</option>
      {/each}
    </select>

    <div class="flex items-center gap-[var(--space-3)]" style="margin-top: var(--space-4)">
      <button
        type="submit"
        disabled={saving || ign.trim() === ""}
        class="rounded-[var(--radius-control)] px-[var(--space-6)] py-[var(--space-3)] font-semibold"
        style="background: {ign.trim() === ''
          ? 'var(--surface-raised)'
          : 'var(--primary)'}; color: {ign.trim() === ''
          ? 'var(--text-tertiary)'
          : 'var(--primary-ink)'}"
      >
        {saving ? "Saving…" : "Continue"}
      </button>
      {#if error}
        <span class="type-caption" role="alert" style="color: var(--danger)">{error}</span>
      {/if}
    </div>
  </form>
</section>
