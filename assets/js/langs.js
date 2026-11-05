/* Language table — one place for the caption languages, their native
   names and the BCP-47 tags used for fonts / speech. */
window.LANGS = [
  { code: "en", name: "English",        native: "English",     bcp: "en-IN" },
  { code: "hi", name: "Hindi",          native: "हिंदी",        bcp: "hi-IN" },
  { code: "mr", name: "Marathi",        native: "मराठी",        bcp: "mr-IN" },
  { code: "gu", name: "Gujarati",       native: "ગુજરાતી",      bcp: "gu-IN" },
  { code: "bn", name: "Bengali",        native: "বাংলা",        bcp: "bn-IN" },
  { code: "ta", name: "Tamil",          native: "தமிழ்",        bcp: "ta-IN" },
  { code: "te", name: "Telugu",         native: "తెలుగు",       bcp: "te-IN" },
  { code: "kn", name: "Kannada",        native: "ಕನ್ನಡ",        bcp: "kn-IN" },
  { code: "ml", name: "Malayalam",      native: "മലയാളം",       bcp: "ml-IN" },
  { code: "pa", name: "Punjabi",        native: "ਪੰਜਾਬੀ",       bcp: "pa-IN" },
  { code: "or", name: "Odia",           native: "ଓଡ଼ିଆ",         bcp: "or-IN" },
  { code: "as", name: "Assamese",       native: "অসমীয়া",       bcp: "as-IN" },
  { code: "ur", name: "Urdu",           native: "اردو",         bcp: "ur-IN" },
  { code: "ru", name: "Russian",        native: "Русский",      bcp: "ru-RU" },
];

window.LANG_BY_CODE = Object.fromEntries(window.LANGS.map(l => [l.code, l]));

/* Quick-search suggestions, each in a different Indian language so the
   "search in your language, search runs in Russian" idea is visible. */
window.QUICK_SEARCHES = [
  { label: "मॉस्को ट्रैवल व्लॉग",  q: "मॉस्को ट्रैवल व्लॉग" },
  { label: "रशियन रेसिपी",         q: "रशियन रेसिपी" },
  { label: "Moscow travel vlog",    q: "Moscow travel vlog" },
  { label: "રશિયન સંગીત",           q: "રશિયન સંગીત" },
  { label: "रशियन भाषा शिका",      q: "रशियन भाषा शिका" },
  { label: "Russian news",          q: "Russian news" },
];
