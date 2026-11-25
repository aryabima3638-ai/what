class CreditService {
  constructor({ users, save, cfg }) { this.users=users; this.save=save; this.cfg=cfg; }
  has(id, n=1) { const u=this.users[String(id)]; return !!u && (u.credits < 0 || u.credits >= n); }
  take(id, n=1) {
    const u=this.users[String(id)]; if (!u) return false;
    if (u.credits < 0) return true;
    if (u.credits < n) return false;
    u.credits -= n; this.save(); return true;
  }
  add(id, n) { const u=this.users[String(id)]; if (!u) return false; if (u.credits >= 0) u.credits += n; this.save(); return true; }
}
module.exports = { CreditService };
