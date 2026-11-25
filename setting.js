// Isi konfigurasi bot di sini. Jangan unggah token ke GitHub publik.
module.exports = {
  BOT_TOKEN: "ISI_TOKEN_BOT_TELEGRAM",
  BOT_USERNAME: "", // tanpa @, opsional
  BOT_LOGO_URL: "https://example.com/logo.png",
  REQUIRED_CHANNEL: "@username_channel",
  CHANNEL_ID: "@username_channel", // bisa berupa -100xxxxxxxxxx
  CHANNEL_URL: "https://t.me/username_channel",
  OWNER_CONTACT: "@polisiband",
  DATABASE_DIR: "./database",
  TEMP_DIR: "./temp",
  DEFAULT_MEMBER_CREDITS: 5,
  DAILY_CREDIT_RESET: false, // true jika ingin isi ulang 5 credit setiap 24 jam
  DAILY_CREDIT_AMOUNT: 5,
  MAX_UPLOAD_MB: 20, // Telegram Bot API cloud getFile umumnya membatasi unduhan bot hingga 20 MB
  MAX_CONCURRENT_BUILDS: 2,
  BUILD_TIMEOUT_MINUTES: 45,
  POLL_INTERVAL_MS: 12000,
  GITHUB: {
    TOKEN: "ISI_GITHUB_TOKEN_CLASSIC_ATAU_FINE_GRAINED",
    OWNER: "USERNAME_GITHUB",
    REPO: "REPOSITORY_BUILDER",
    BRANCH: "main",
    WORKFLOW_FILE: "flutter-build.yml"
  },
  WEB_BUILD: {
    ENABLED: true,
    // Web build menggunakan Flutter web jika ZIP berisi project Flutter.
    // Untuk HTML/CSS/JS statis, workflow akan mengemas source sebagai artifact.
  }
};
