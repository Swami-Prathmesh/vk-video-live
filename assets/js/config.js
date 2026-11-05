/* ------------------------------------------------------------------
   config.js — the only file you normally need to touch.
   ------------------------------------------------------------------
   API_BASE  : base URL of the Cloudflare Worker (see /worker).
               Leave it empty ("") to run the site in DEMO mode:
               the UI, the player and the translated caption panel all
               work, but results come from the bundled demo catalogue.
   REPO_URL  : the public GitHub repo shown in the header.
   VK_EMBED  : template used for VK video iframes when a direct mp4
               file is not returned by the API.
   ------------------------------------------------------------------ */
window.CONFIG = {
  API_BASE: "",
  REPO_URL: "https://github.com/Swami-Prathmesh/vk-video-live",
  VK_EMBED: "https://vk.com/video_ext.php",
  DEFAULT_CAPTION_LANG: "hi",
  SEARCH_DEBOUNCE_MS: 320,
};
