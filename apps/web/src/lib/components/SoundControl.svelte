<script lang="ts">
  import type { NotifyPrefs } from "$lib/notify.ts";

  /**
   * Mute and volume for the match gong.
   *
   * An unmuteable sound is how a tool gets closed permanently, so this is not
   * buried in a settings page — it sits beside the board where someone
   * startled by the sound can reach it without hunting.
   *
   * Preview matters more than it looks: the gong fires once, when the user is
   * not looking, and there is no other way to find out what volume 0.3 sounds
   * like before trusting it to wake you.
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
