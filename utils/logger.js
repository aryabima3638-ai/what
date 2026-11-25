class Logger {
  info(...a){ console.log(new Date().toISOString(),"[INFO]",...a); }
  error(label,e){ console.error(new Date().toISOString(),"[ERROR]",label,e?.stack||e); }
}
module.exports = { Logger };
