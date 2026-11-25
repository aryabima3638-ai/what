const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const extract = require("extract-zip");
const crypto = require("crypto");
const cfg = require("./setting");
const { OWNER_IDS } = require("./telegram");
const app = require("./config");
const { GitHubBuildService } = require("./services/github");
const { CreditService } = require("./services/credit");
const { Logger } = require("./utils/logger");

for (const dir of [cfg.DATABASE_DIR, cfg.TEMP_DIR]) fs.mkdirSync(dir, { recursive: true });
const dbFile = n => path.join(cfg.DATABASE_DIR, n + ".json");
function readDb(n) { try { return JSON.parse(fs.readFileSync(dbFile(n), "utf8")); } catch { return {}; } }
function writeDb(n, data) { fs.writeFileSync(dbFile(n), JSON.stringify(data, null, 2)); }
const users = readDb("users"), builds = readDb("builds"), jobs = readDb("jobs");
const logger = new Logger();
const credits = new CreditService({ users, save: () => writeDb("users", users), cfg });
const gh = new GitHubBuildService(cfg, logger);
const bot = new Telegraf(cfg.BOT_TOKEN);
const owner = id => OWNER_IDS.map(Number).includes(Number(id));
const role = id => users[id]?.role || "member";
const isResellerOrOwner = id => ["reseller", "owner"].includes(role(id)) || owner(id);
const isOwner = id => owner(id) || role(id) === "owner";
const mainKeyboard = id => {
  const rows = [
    [Markup.button.callback("📱 Flutter Build", "build:flutter"), Markup.button.callback("🌐 Web Build", "build:web")],
    [Markup.button.callback("💳 My Credit", "me:credit"), Markup.button.callback("👤 My Profile", "me:profile")],
    [Markup.button.callback("📜 Build History", "me:history"), Markup.button.callback("🆘 Contact Owner", "me:contact")]
  ];
  if (isOwner(id)) rows.push([Markup.button.callback("👑 Owner Panel", "owner:panel")]);
  if (isResellerOrOwner(id)) rows.push([Markup.button.callback("🛒 Reseller Panel", "reseller:panel")]);
  return Markup.inlineKeyboard(rows);
};
const ownerKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback("🟢 Maintenance ON", "maint:on"), Markup.button.callback("🔴 Maintenance OFF", "maint:off")],
  [Markup.button.callback("📊 Statistics", "owner:stats"), Markup.button.callback("📋 Active Builds", "owner:jobs")],
  [Markup.button.callback("⬅️ Menu", "menu")]
]);
let maintenance = false;
const activeUploads = new Map();

async function channelMember(ctx) {
  if (!cfg.REQUIRED_CHANNEL) return true;
  try {
    const m = await ctx.telegram.getChatMember(cfg.REQUIRED_CHANNEL, ctx.from.id);
    return ["creator", "administrator", "member"].includes(m.status) || (m.status === "restricted" && m.is_member);
  } catch (e) { logger.error("getChatMember", e); return false; }
}
async function notifyChannel(ctx, text) {
  if (!cfg.CHANNEL_ID) return;
  try { await ctx.telegram.sendMessage(cfg.CHANNEL_ID, text, { parse_mode: "HTML", disable_web_page_preview: true }); }
  catch (e) { logger.error("channel notification", e); }
}
async function sendWelcome(ctx) {
  const caption = `✨ <b>${app.APP_NAME}</b>\n\nSelamat datang! Ikuti channel terlebih dahulu lalu tekan VERIFIKASI.`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.url("📢 FOLLOW CHANNEL", cfg.CHANNEL_URL || "https://t.me/")],
    [Markup.button.callback("✅ VERIFIKASI", "verify")]
  ]);
  if (cfg.BOT_LOGO_URL && /^https?:\/\//i.test(cfg.BOT_LOGO_URL)) {
    try { return await ctx.replyWithPhoto(cfg.BOT_LOGO_URL, { caption, parse_mode: "HTML", ...kb }); } catch {}
  }
  return ctx.reply(caption, { parse_mode: "HTML", ...kb });
}
function ensureUser(ctx) {
  const id = String(ctx.from.id);
  if (!users[id]) {
    users[id] = { id: Number(id), username: ctx.from.username || "", first_name: ctx.from.first_name || "", role: owner(id) ? "owner" : "member", credits: owner(id) ? -1 : cfg.DEFAULT_MEMBER_CREDITS, joined_at: new Date().toISOString(), last_daily_reset: Date.now() };
    writeDb("users", users);
    notifyChannel(ctx, `🆕 <b>USER REGISTER</b>\nNama: ${escapeHtml(ctx.from.first_name || "-")}\nUsername: @${escapeHtml(ctx.from.username || "-")}\nID: <code>${id}</code>`);
  } else {
    users[id].username = ctx.from.username || users[id].username;
    if (owner(id)) users[id].role = "owner";
    writeDb("users", users);
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c])); }
async function showMenu(ctx) {
  ensureUser(ctx);
  const u = users[String(ctx.from.id)];
  const c = u.credits < 0 ? "Unlimited" : u.credits;
  return ctx.reply(`👋 Halo <b>${escapeHtml(ctx.from.first_name || "User")}</b>\n\nRole: <b>${u.role.toUpperCase()}</b>\nCredit: <b>${c}</b>\n\nPilih layanan di bawah:`, { parse_mode: "HTML", ...mainKeyboard(ctx.from.id) });
}
bot.start(async ctx => {
  ensureUser(ctx);
  if (!(await channelMember(ctx))) return sendWelcome(ctx);
  return showMenu(ctx);
});
bot.command("menu", async ctx => {
  if (!(await channelMember(ctx))) return sendWelcome(ctx);
  return showMenu(ctx);
});
bot.action("verify", async ctx => {
  await ctx.answerCbQuery();
  if (!(await channelMember(ctx))) return ctx.reply("❌ Kamu belum terdeteksi join channel. Join dahulu, lalu tekan VERIFIKASI.");
  ensureUser(ctx);
  await ctx.reply("✅ Verifikasi berhasil. Selamat menggunakan bot!");
  return showMenu(ctx);
});
bot.action("menu", async ctx => { await ctx.answerCbQuery(); if (!(await channelMember(ctx))) return sendWelcome(ctx); return showMenu(ctx); });
bot.action("build:flutter", async ctx => {
  await ctx.answerCbQuery();
  if (maintenance && !isOwner(ctx.from.id)) return ctx.reply("MAAF BOT SEDANH DITUTUP OLEH OWNER DIKARENAKAN ADA SEDIKIT MASALAH");
  return ctx.reply("📱 PILIH JENIS BUILD FLUTTER", Markup.inlineKeyboard([
    [Markup.button.callback("🚀 RELEASE APK", "build:flutter_release")],
    [Markup.button.callback("🧪 DEBUG APK", "build:flutter_debug")],
    [Markup.button.callback("⬅️ Kembali", "menu")]
  ]));
});
bot.action(/^build:(flutter_release|flutter_debug|web)$/, async ctx => {
  await ctx.answerCbQuery();
  if (maintenance && !isOwner(ctx.from.id)) return ctx.reply("MAAF BOT SEDANH DITUTUP OLEH OWNER DIKARENAKAN ADA SEDIKIT MASALAH");
  if (!(await channelMember(ctx))) return sendWelcome(ctx);
  const kind = ctx.match[1];
  activeUploads.set(ctx.from.id, { kind, at: Date.now() });
  const label = kind === "web" ? "WEB" : (kind === "flutter_debug" ? "FLUTTER DEBUG" : "FLUTTER RELEASE");
  return ctx.reply(`📦 <b>${label} BUILD</b>\n\nKirim file project dalam format ZIP sebagai dokumen.\nBatas unduhan bot saat ini: ${cfg.MAX_UPLOAD_MB} MB.`, { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Batal", "upload:cancel")]]) });
});
bot.action("upload:cancel", async ctx => { activeUploads.delete(ctx.from.id); await ctx.answerCbQuery("Dibatalkan"); return ctx.reply("Upload dibatalkan.", mainKeyboard(ctx.from.id)); });
bot.on("document", async ctx => {
  const id = String(ctx.from.id), session = activeUploads.get(ctx.from.id);
  if (!session) return;
  if (maintenance && !isOwner(id)) { activeUploads.delete(ctx.from.id); return ctx.reply("MAAF BOT SEDANH DITUTUP OLEH OWNER DIKARENAKAN ADA SEDIKIT MASALAH"); }
  const doc = ctx.message.document;
  if (!doc.file_name?.toLowerCase().endsWith(".zip")) return ctx.reply("❌ File harus berformat .zip.");
  if (doc.file_size > cfg.MAX_UPLOAD_MB * 1024 * 1024) return ctx.reply(`❌ File melewati batas ${cfg.MAX_UPLOAD_MB} MB. Ubah MAX_UPLOAD_MB hanya jika infrastruktur Telegram kamu mendukungnya.`);
  if (role(id) === "member" && !credits.has(id, 1)) { activeUploads.delete(ctx.from.id); return ctx.reply(`CREDIT ANDA SUDAH HABIS!!! SILAHKAN BELI CREDIT/TUNGGU 1 HARI LAGI UNTUK MENDAPATKAN CREDIT ANDA KEMBALI OWNER : ${cfg.OWNER_CONTACT}`); }
  const running = Object.values(jobs).filter(j => ["queued", "running"].includes(j.status)).length;
  if (running >= cfg.MAX_CONCURRENT_BUILDS) return ctx.reply("⏳ Antrean build sedang penuh. Coba beberapa saat lagi.");
  const jobId = crypto.randomBytes(6).toString("hex");
  const workDir = path.join(cfg.TEMP_DIR, jobId); fs.mkdirSync(workDir, { recursive: true });
  let charged = false;
  try {
    await ctx.reply("⬇️ Mengunduh ZIP dari Telegram...");
    const link = await ctx.telegram.getFileLink(doc.file_id);
    const zipPath = path.join(workDir, "source.zip");
    const response = await axios({ url: link.href, method: "GET", responseType: "stream", timeout: 120000 });
    await new Promise((resolve, reject) => { const out = fs.createWriteStream(zipPath); response.data.pipe(out); out.on("finish", resolve); out.on("error", reject); response.data.on("error", reject); });
    await extract(zipPath, { dir: path.join(workDir, "source") });
    const sourceDir = path.join(workDir, "source");
    const entries = fs.readdirSync(sourceDir);
    if (!entries.length) throw new Error("ZIP kosong.");
    if (session.kind.startsWith("flutter") && !findFile(sourceDir, "pubspec.yaml")) throw new Error("Project Flutter tidak ditemukan: pubspec.yaml tidak ada.");
    if (role(id) === "member") { if (!credits.take(id, 1)) throw new Error("Credit tidak cukup."); charged = true; }
    jobs[jobId] = { id: jobId, user_id: Number(id), mode: session.kind, status: "queued", file_name: doc.file_name, created_at: new Date().toISOString(), charged };
    writeDb("jobs", jobs); activeUploads.delete(ctx.from.id);
    await ctx.reply(`🚀 Build #${jobId} masuk antrean. Credit dipotong 1 saat build dimulai.`);
    const result = await gh.startBuild({ jobId, mode: session.kind, sourceDir });
    jobs[jobId].status = "running"; jobs[jobId].run_id = result.run_id; jobs[jobId].started_at = new Date().toISOString(); writeDb("jobs", jobs);
    await ctx.reply(`⚙️ GitHub Actions dimulai.\nJob: <code>${jobId}</code>\nRun: <code>${result.run_id}</code>\nBot akan mengirim hasil otomatis.`, { parse_mode: "HTML" });
    pollJob(jobId, ctx.telegram).catch(e => logger.error("pollJob", e));
  } catch (e) {
    if (charged) credits.add(id, 1);
    activeUploads.delete(ctx.from.id);
    if (jobs[jobId]) { jobs[jobId].status = "failed"; jobs[jobId].error = e.message; writeDb("jobs", jobs); }
    await ctx.reply(`❌ Gagal menyiapkan build.\n\n<pre>${escapeHtml(String(e.message).slice(0, 3000))}</pre>\nCredit yang terpotong dikembalikan jika proses belum berhasil dimulai.`, { parse_mode: "HTML" }).catch(()=>{});
    logger.error("upload/build preparation", e);
  }
});
function findFile(dir, name) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isFile() && ent.name === name) return p;
    if (ent.isDirectory() && ![".git", "node_modules", "build"].includes(ent.name)) { const f = findFile(p, name); if (f) return f; }
  }
  return null;
}
async function pollJob(jobId, telegram) {
  const job = jobs[jobId], started = Date.now();
  while (Date.now() - started < cfg.BUILD_TIMEOUT_MINUTES * 60000) {
    await new Promise(r => setTimeout(r, cfg.POLL_INTERVAL_MS));
    if (maintenance) {
      try { await gh.cancelRun(job.run_id); } catch {}
      job.status = "cancelled"; job.error = "Dibatalkan karena maintenance.";
      if (job.charged) credits.add(job.user_id, 1);
      writeDb("jobs", jobs);
      await telegram.sendMessage(job.user_id, "MAAF BOT SEDANH DITUTUP OLEH OWNER DIKARENAKAN ADA SEDIKIT MASALAH\nBuild dibatalkan dan credit dikembalikan.");
      return;
    }
    const state = await gh.getRun(job.run_id);
    if (state.status === "completed") {
      if (state.conclusion === "success") {
        const artifact = await gh.downloadArtifact(job.run_id, jobId, path.join(cfg.TEMP_DIR, `${jobId}-artifact.zip`));
        const output = path.join(cfg.TEMP_DIR, `${jobId}-output`); fs.mkdirSync(output, { recursive: true });
        await extract(artifact, { dir: output });
        const apk = findExtension(output, ".apk");
        const html = findFile(output, "index.html");
        if (apk) await telegram.sendDocument(job.user_id, { source: apk }, { caption: `✅ Build berhasil!\nJob: ${jobId}` });
        else if (html) await telegram.sendDocument(job.user_id, { source: html }, { caption: `✅ Web build berhasil. File index.html terlampir.` });
        else await telegram.sendMessage(job.user_id, `✅ Workflow berhasil, tetapi APK/HTML tidak ditemukan dalam artifact. Job: ${jobId}`);
        job.status = "success";
      } else {
        const log = await gh.getRunLogs(job.run_id).catch(e => `Gagal mengambil log: ${e.message}`);
        await telegram.sendMessage(job.user_id, `❌ BUILD GAGAL\nJob: ${jobId}\nKesalahan: ${state.conclusion}\n\nLOG (potongan terakhir):\n<pre>${escapeHtml(log.slice(-app.MAX_LOG_CHARS))}</pre>`, { parse_mode: "HTML" });
        job.status = "failed"; job.error = state.conclusion;
        if (job.charged) credits.add(job.user_id, 1);
      }
      job.finished_at = new Date().toISOString(); writeDb("jobs", jobs); return;
    }
  }
  try { await gh.cancelRun(job.run_id); } catch {}
  job.status = "timeout"; job.error = "Melewati batas waktu bot.";
  if (job.charged) credits.add(job.user_id, 1);
  writeDb("jobs", jobs);
  await telegram.sendMessage(job.user_id, `⏰ Build #${jobId} timeout. Workflow dibatalkan jika masih berjalan dan credit dikembalikan.`);
}
function findExtension(dir, ext) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isFile() && ent.name.toLowerCase().endsWith(ext)) return p;
    if (ent.isDirectory()) { const f = findExtension(p, ext); if (f) return f; }
  }
  return null;
}
bot.action("me:credit", async ctx => { await ctx.answerCbQuery(); const u=users[String(ctx.from.id)]; return ctx.reply(`💳 Credit: ${u.credits < 0 ? "Unlimited" : u.credits}\nRole: ${u.role}\nUntuk pembelian credit hubungi ${cfg.OWNER_CONTACT}`); });
bot.action("me:profile", async ctx => { await ctx.answerCbQuery(); const u=users[String(ctx.from.id)]; return ctx.reply(`👤 PROFILE\nID: ${u.id}\nUsername: @${u.username || "-"}\nRole: ${u.role}\nCredit: ${u.credits < 0 ? "Unlimited" : u.credits}`); });
bot.action("me:history", async ctx => { await ctx.answerCbQuery(); const list=Object.values(jobs).filter(j=>j.user_id===ctx.from.id).slice(-10); return ctx.reply(list.length ? list.map(j=>`${j.id} | ${j.mode} | ${j.status}`).join("\n") : "Belum ada riwayat build."); });
bot.action("me:contact", async ctx => { await ctx.answerCbQuery(); return ctx.reply(`Kontak owner: ${cfg.OWNER_CONTACT}`); });
bot.action("owner:panel", async ctx => { await ctx.answerCbQuery(); if (!isOwner(ctx.from.id)) return ctx.reply("Akses ditolak."); return ctx.reply("👑 OWNER CONTROL PANEL", ownerKeyboard()); });
bot.action(/^maint:(on|off)$/, async ctx => {
  await ctx.answerCbQuery();
  if (!isOwner(ctx.from.id)) return ctx.reply("Akses ditolak. Khusus owner.");
  maintenance = ctx.match[1] === "on";
  await ctx.reply(`Maintenance ${maintenance ? "AKTIF" : "NONAKTIF"}.`);
  if (maintenance) {
    for (const j of Object.values(jobs).filter(x => ["queued","running"].includes(x.status))) {
      if (j.run_id) gh.cancelRun(j.run_id).catch(()=>{});
    }
  }
});
bot.action("owner:stats", async ctx => { await ctx.answerCbQuery(); if (!isOwner(ctx.from.id)) return; return ctx.reply(`Users: ${Object.keys(users).length}\nBuilds: ${Object.keys(jobs).length}\nMaintenance: ${maintenance ? "ON" : "OFF"}`); });
bot.action("owner:jobs", async ctx => { await ctx.answerCbQuery(); if (!isOwner(ctx.from.id)) return; const list=Object.values(jobs).filter(j=>["queued","running"].includes(j.status)); return ctx.reply(list.length ? list.map(j=>`${j.id} | ${j.status} | ${j.user_id}`).join("\n") : "Tidak ada build aktif."); });
bot.action("reseller:panel", async ctx => { await ctx.answerCbQuery(); if (!isResellerOrOwner(ctx.from.id)) return ctx.reply("Khusus reseller/owner."); return ctx.reply("🛒 RESELLER PANEL\nGunakan /addcredit ID JUMLAH untuk menambahkan credit."); });
bot.command("addcredit", async ctx => {
  if (!isResellerOrOwner(ctx.from.id)) return ctx.reply("⚠️ Warning: hanya role di atas member yang bisa memakai command ini!");
  const [, target, amount] = ctx.message.text.trim().split(/\s+/);
  const n = Number(amount);
  if (!/^\d+$/.test(target || "") || !Number.isInteger(n) || n < 1 || n > 100000) return ctx.reply("Format: /addcredit ID JUMLAH");
  if (!users[target]) return ctx.reply("User belum terdaftar di bot.");
  credits.add(target, n);
  return ctx.reply(`✅ Berhasil menambahkan ${n} credit ke ${target}.`);
});
bot.command("address", async ctx => {
  if (!isOwner(ctx.from.id)) return ctx.reply("⚠️ Warning: command ini hanya bisa digunakan Owner!");
  const target=ctx.message.text.trim().split(/\s+/)[1];
  if (!/^\d+$/.test(target || "") || !users[target]) return ctx.reply("Format: /address USER_ID (user harus pernah /start bot)");
  users[target].role="reseller"; users[target].credits=-1; writeDb("users", users);
  return ctx.reply(`✅ ${target} sekarang menjadi Reseller.`);
});
bot.command("addowner", async ctx => {
  if (!isOwner(ctx.from.id)) return ctx.reply("⚠️ Warning: command ini hanya bisa digunakan Owner!");
  const target=ctx.message.text.trim().split(/\s+/)[1];
  if (!/^\d+$/.test(target || "")) return ctx.reply("Format: /addowner USER_ID");
  if (!users[target]) return ctx.reply("User harus pernah /start bot terlebih dahulu.");
  users[target].role="owner"; users[target].credits=-1; writeDb("users", users);
  return ctx.reply(`✅ ${target} sekarang menjadi Owner aplikasi.`);
});
bot.catch(err => logger.error("Telegraf", err));
bot.launch().then(()=>logger.info("Bot started")).catch(e=>{logger.error("Bot startup",e);process.exit(1);});
process.once("SIGINT",()=>bot.stop("SIGINT"));
process.once("SIGTERM",()=>bot.stop("SIGTERM"));
