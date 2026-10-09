import fs from 'node:fs';

import path from 'node:path';

import { fileURLToPath } from 'node:url';

const HOUR_MS = 60 * 60 * 1000;

const MAX_WINDOWS = 24;

const SAFE_CODE = /^[A-Za-z0-9_:./-]{1,80}$/;

function normalizedHour(value) {
 const ms=new Date(value).getTime();
 if(!Number.isFinite(ms)||ms%HOUR_MS!==0)throw new Error("Invalid alert window");
 return new Date(ms).toISOString();
}

async function request(apiBase,headers,apiPath,options={}){
 const res=await fetch(`${apiBase}${apiPath}`,{...options,headers:{...headers,...(options.headers||{})}});
 if(!res.ok)throw new Error(`GitHub API ${res.status} for ${apiPath}`);
 if(res.status===204)return null;
 return res.json();
}

async function pagedRead(requestFn,endpoint){
 const results=[];
 for(let page=1;;page++){
   const separator=endpoint.includes("?")?"&":"?";
   const batch=await requestFn(`${endpoint}${separator}per_page=100&page=${page}`);
   if(!Array.isArray(batch))throw new Error("Invalid GitHub API listing");
   results.push(...batch);
   if(batch.length<100)return results;
 }
}

function windowsAlreadyPublished(value){
 const found=new Set();
 for(const match of String(value??"").matchAll(/<!-- onepick-real-user-error-window:([^\s>]+) -->/g)){
   try{found.add(normalizedHour(match[1]))}catch{}
 }
 for(const match of String(value??"").matchAll(/- last completed hour:\s*[^\n]*?→\s*([^\s\n]+)/g)){
   try{found.add(normalizedHour(match[1]))}catch{}
 }
 return found;
}

function entryText(alert,workflowUrl){
 const reason=alert.reasons.includes("new_error_code")?"A new error_code appeared in the completed hour.":"The error count exceeded 3× the previous seven matching-hour average.";
 const ratio=alert.ratio==null?"baseline 0":`${alert.ratio}×`;
 const locations=alert.locations.length?alert.locations.map(x=>`- ${x.context} / ${x.platform}: ${x.count}`).join("\n"):"- none";
 return `<!-- onepick-real-user-error-window:${alert.windowEnd} -->\n\n${reason}\n\n`+
 `- error_code: \`${alert.errorCode}\`\n`+
 `- last completed hour: ${alert.windowStart} → ${alert.windowEnd}\n`+
 `- count: ${alert.currentCount}\n`+
 `- previous 7 matching-hour average: ${alert.baselineAverage}\n`+
 `- ratio: ${ratio}\n`+
 `- previous 7 days total for this error_code: ${alert.previous7dCount}\n`+
 `- current locations:\n${locations}\n\n`+
 `Workflow: ${workflowUrl}\n\n`+
 "This check used the Supabase read-only query endpoint. No database mutation was attempted.";
}

export async function publishAlerts(report,{requestFn,repository,workflowUrl}){
 const generatedAtMs=Date.parse(report.generatedAt);
 if(!Number.isFinite(generatedAtMs))throw new Error("Invalid evaluation timestamp");
 // A query can finish before the UTC hour turns while report generation finishes after it.
 // Anchor the bounded lookback to the completed UTC-hour boundary, not the extra seconds.
 const generatedHourMs=Math.floor(generatedAtMs/HOUR_MS)*HOUR_MS;
 const groups=new Map(),allWindows=new Set();
 for(const original of report.alerts??[]){
   const code=String(original.errorCode??"");
   if(!SAFE_CODE.test(code))throw new Error("Invalid error code in report");
   const start=normalizedHour(original.windowStart),end=normalizedHour(original.windowEnd),endMs=Date.parse(end);
   if(endMs-Date.parse(start)!==HOUR_MS||endMs>generatedAtMs||endMs<generatedHourMs-MAX_WINDOWS*HOUR_MS){
     throw new Error("Alert outside the bounded completed-hour lookback");
   }
   allWindows.add(end);
   const alert={...original,errorCode:code,windowStart:start,windowEnd:end};
   if(!groups.has(code))groups.set(code,new Map());
   groups.get(code).set(end,alert);
 }
 if(allWindows.size>MAX_WINDOWS)throw new Error("Lookback exceeded 24 completed hours");
 if(allWindows.size){
   const ends=[...allWindows].map(Date.parse);
   if(Math.max(...ends)-Math.min(...ends)>=MAX_WINDOWS*HOUR_MS)throw new Error("Lookback exceeded 24 completed hours");
 }
 const issues=(await pagedRead(requestFn,"/issues?state=all&labels=qa-alert")).filter(issue=>!issue.pull_request);
 let newlyPublished=0,skippedDuplicates=0;
 for(const [code,windowAlerts] of groups){
   const codeMarker=`<!-- onepick-real-user-error:error-code:${code} -->`;
   const matchingIssues=issues.filter(issue=>(issue.body||"").includes(codeMarker));
   const openIssue=matchingIssues.find(issue=>issue.state==="open");
   const seen=new Set();
   for(const issue of matchingIssues){
     for(const windowEnd of windowsAlreadyPublished(issue.body))seen.add(windowEnd);
     const comments=await pagedRead(requestFn,`/issues/${issue.number}/comments`);
     for(const comment of comments)for(const windowEnd of windowsAlreadyPublished(comment.body))seen.add(windowEnd);
   }
   const newEntries=[...windowAlerts.values()].sort((a,b)=>a.windowEnd.localeCompare(b.windowEnd)).filter(alert=>{
     if(seen.has(alert.windowEnd)){skippedDuplicates+=1;return false}
     return true;
   });
   if(!newEntries.length)continue;
   const entriesText=newEntries.map(alert=>entryText(alert,workflowUrl)).join("\n\n---\n\n");
   if(openIssue){
     await requestFn(`/issues/${openIssue.number}/comments`,{method:"POST",body:JSON.stringify({body:entriesText})});
   }else{
     const created=await requestFn("/issues",{method:"POST",body:JSON.stringify({
       title:`[qa-alert] Real-user error: ${code}`,body:`${codeMarker}\n\n${entriesText}`,labels:["qa-alert"]
     })});
     issues.push(created);
   }
   newlyPublished+=newEntries.length;
 }
 return {newlyPublished,skippedDuplicates};
}

async function main(){
 const reportPath=process.env.QA_ALERT_OUTPUT,repository=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN;
 if(!reportPath||!repository||!token)throw new Error("QA_ALERT_OUTPUT, GITHUB_REPOSITORY and GITHUB_TOKEN are required");
 const report=JSON.parse(fs.readFileSync(reportPath,"utf8"));
 const [owner,repo]=repository.split("/");
 if(!owner||!repo)throw new Error("Invalid repository");
 const apiBase=`https://api.github.com/repos/${owner}/${repo}`;
 const headers={Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"};
 const workflowUrl=`${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
 const result=await publishAlerts(report,{repository,workflowUrl,requestFn:(p,opts)=>request(apiBase,headers,p,opts)});
 if(process.env.GITHUB_STEP_SUMMARY){
   fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Real-user error alerts\n- Hourly findings: ${report.alertCount??0}\n`+
    `- Published new hourly windows: ${result.newlyPublished}\n`+
    `- Already reported windows: ${result.skippedDuplicates}\n`);
 }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) main().catch((err) => {

  console.error(`Real-user alert publication failed: ${String(err?.message || err).slice(0,160)}`);

  process.exitCode = 1;
});
