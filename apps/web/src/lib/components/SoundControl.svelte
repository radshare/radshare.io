<script lang="ts">
  import type { NotifyPrefs } from "$lib/notify.ts";

  /**
   * Beside the board rather than in a settings page: an unmuteable sound is how
   * a tool gets closed permanently, and someone startled by it should not hunt.
   *
   * Preview earns its place — the gong fires once, when you are not looking, so
   * there is no other way to learn what 0.3 sounds like before trusting it.
   */
  let {
    prefs,
    notificationsAvailable,
    onMute,
    onVolume,
    onPreview,
    onEnableNotifications,
  }: {
    prefs: NotifyPrefs;
    notificationsAvailable: boolean;
    onMute: (muted: boolean) => void;
    onVolume: (volume: number) => void;
    onPreview: () => void;
    onEnableNotifications: () => void;
  } = $props();
</script>

<div class="flex flex-wrap items-center gap-[var(--space-3)]" style="margin-top: var(--space-4)">
  <label class="type-caption inline-flex items-center gap-[var(--space-2)]">
    <input
      type="checkbox"
      checked={!prefs.muted}
      onchange={(e) => onMute(!e.currentTarget.checked)}
    />
    Match sound
  </label>

  <label class="type-caption inline-flex items-center gap-[var(--space-2)]">
    Volume
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={prefs.volume}
      disabled={prefs.muted}
      oninput={(e) => onVolume(Number(e.currentTarget.value))}
      aria-label="Match sound volume"
    />
  </label>

  <button
    type="button"
    class="type-caption underline"
    disabled={prefs.muted}
    onclick={onPreview}
  >
    Preview
  </button>

  {#if notificationsAvailable}
    <button type="button" class="type-caption underline" onclick={onEnableNotifications}>
      Enable notifications
    </button>
  {/if}
</div>
