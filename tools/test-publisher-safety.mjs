import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const publisher=fs.readFileSync(new URL("./publish-github-release.zsh",import.meta.url),"utf8");
const match=/stage_initial_safe_snapshot\(\) \{[\s\S]*?\n\}\n\nstage_release_changes_only/.exec(publisher);
assert.ok(match,"initial snapshot staging function is present");
const functionSource=match[0].replace(/\n\nstage_release_changes_only$/,"");
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),"izzy-publisher-"));
const quote=value=>`'${String(value).replaceAll("'","'\\''")}'`;

try{
  fs.writeFileSync(path.join(fixture,".gitignore"),"ignored.txt\n","utf8");
  fs.writeFileSync(path.join(fixture,"ignored.txt"),"private\n","utf8");
  fs.writeFileSync(path.join(fixture,"keep.txt"),"public\n","utf8");
  assert.equal(spawnSync("git",["init","-q"],{cwd:fixture}).status,0);
  const shell=`set -euo pipefail\nPROJECT_ROOT=${quote(fixture)}\nlog(){ :; }\n${functionSource}\nstage_initial_safe_snapshot`;
  const staged=spawnSync("/bin/zsh",["-c",shell],{encoding:"utf8"});
  assert.equal(staged.status,0,staged.stderr||staged.stdout);
  const names=spawnSync("git",["diff","--cached","--name-only"],{cwd:fixture,encoding:"utf8"});
  assert.equal(names.status,0,names.stderr);
  assert.deepEqual(names.stdout.trim().split("\n").sort(),[".gitignore","keep.txt"]);
}finally{
  fs.rmSync(fixture,{recursive:true,force:true});
}

console.log("Publisher safety tests passed: ignored files are skipped while trackable files are staged.");
