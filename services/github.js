const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const { execFile } = require("child_process");
const { promisify } = require("util");
const run = promisify(execFile);
class GitHubBuildService {
  constructor(cfg, logger) {
    this.cfg=cfg; this.logger=logger;
    const g=cfg.GITHUB;
    if (!g.TOKEN || g.TOKEN.startsWith("ISI_") || !g.OWNER || g.OWNER==="USERNAME_GITHUB" || !g.REPO || g.REPO==="REPOSITORY_BUILDER") throw new Error("Konfigurasi GitHub belum lengkap di setting.js");
    this.base=`https://api.github.com/repos/${g.OWNER}/${g.REPO}`;
    this.headers={Authorization:`Bearer ${g.TOKEN}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
  }
  async request(method,url,data,extra={}) { return axios({method,url,data,headers:{...this.headers,...(extra.headers||{})},timeout:120000,maxBodyLength:Infinity,maxContentLength:Infinity,...extra}); }
  async startBuild({jobId,mode,sourceDir}) {
    // ZIP upload ke repository via Git Data API: buat tree dari file, batasi total payload agar API tidak overload.
    const files=[];
    const walk=(dir,rel="")=>{ for(const e of fs.readdirSync(dir,{withFileTypes:true})){ if([".git","node_modules","build"].includes(e.name)) continue; const p=path.join(dir,e.name), r=path.posix.join(rel,e.name); if(e.isDirectory()) walk(p,r); else files.push({p,r}); } };
    walk(sourceDir);
    if(!files.length) throw new Error("Folder project kosong.");
    if(files.length>250) throw new Error("Project berisi lebih dari 250 file. Gunakan project yang lebih ringkas atau mekanisme upload Git LFS.");
    const tree=[];
    for(const f of files) {
      const buf=fs.readFileSync(f.p);
      if(buf.length>900000) throw new Error(`File ${f.r} terlalu besar untuk GitHub Contents API (>900 KB per file pada jalur ini).`);
      const blob=await this.request("POST",`${this.base}/git/blobs`,{content:buf.toString("base64"),encoding:"base64"});
      tree.push({path:`.build-inputs/${jobId}/${f.r}`,mode:"100644",type:"blob",sha:blob.data.sha});
    }
    const ref=await this.request("GET",`${this.base}/git/ref/heads/${this.cfg.GITHUB.BRANCH}`);
    const parent=ref.data.object.sha;
    const baseTree=await this.request("GET",`${this.base}/git/commits/${parent}`);
    const newTree=await this.request("POST",`${this.base}/git/trees`,{base_tree:baseTree.data.tree.sha,tree});
    const commit=await this.request("POST",`${this.base}/git/commits`,{message:`Build input ${jobId}`,tree:newTree.data.sha,parents:[parent]});
    await this.request("PATCH",`${this.base}/git/refs/heads/${this.cfg.GITHUB.BRANCH}`,{sha:commit.data.sha});
    const dispatch=await this.request("POST",`${this.base}/actions/workflows/${this.cfg.GITHUB.WORKFLOW_FILE}/dispatches`,{ref:this.cfg.GITHUB.BRANCH,inputs:{job_id:jobId,mode}});
    // Workflow dispatch endpoint returns 204; locate run by polling recent workflow runs.
    let runId=null;
    for(let i=0;i<12 && !runId;i++){ await new Promise(r=>setTimeout(r,2500)); const r=await this.request("GET",`${this.base}/actions/workflows/${this.cfg.GITHUB.WORKFLOW_FILE}/runs?branch=${this.cfg.GITHUB.BRANCH}&per_page=10`); const item=r.data.workflow_runs.find(x=>x.head_sha===commit.data.sha); if(item) runId=item.id; }
    if(!runId) throw new Error("Workflow berhasil dipicu tetapi run_id belum ditemukan. Periksa Actions pada repository.");
    return {run_id:runId};
  }
  async getRun(id) { const r=await this.request("GET",`${this.base}/actions/runs/${id}`); return r.data; }
  async cancelRun(id) { if(id) await this.request("POST",`${this.base}/actions/runs/${id}/cancel`); }
  async downloadArtifact(runId,jobId,dest) {
    const r=await this.request("GET",`${this.base}/actions/runs/${runId}/artifacts`);
    const a=r.data.artifacts.find(x=>x.name===`build-${jobId}`);
    if(!a) throw new Error("Artifact build tidak ditemukan.");
    const d=await this.request("GET",`${this.base}/actions/artifacts/${a.id}/zip`,null,{headers:{Accept:"application/vnd.github+json"},responseType:"arraybuffer"});
    fs.writeFileSync(dest,Buffer.from(d.data));
    return dest;
  }
  async getRunLogs(runId) {
    const r=await this.request("GET",`${this.base}/actions/runs/${runId}/logs`,null,{headers:{Accept:"application/vnd.github+json"},responseType:"arraybuffer"});
    const zip=path.join(this.cfg.TEMP_DIR,`logs-${runId}.zip`); fs.writeFileSync(zip,Buffer.from(r.data));
    const dir=path.join(this.cfg.TEMP_DIR,`logs-${runId}`); fs.mkdirSync(dir,{recursive:true});
    await run("unzip",["-o",zip,"-d",dir]);
    let out="";
    const scan=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())scan(p);else if(/\.(txt|log)$/i.test(e.name))out+=`\n===== ${e.name} =====\n`+fs.readFileSync(p,"utf8");}};
    scan(dir); return out || "GitHub tidak menyediakan isi log dalam arsip.";
  }
}
module.exports = { GitHubBuildService };
