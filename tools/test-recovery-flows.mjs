import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");

// An unpublished installer must verify and open an existing app instead of failing.
const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),"izzy-recovery-"));
class TestFileManager {
  documentsDirectory(){return temporaryRoot;}
  joinPath(a,b){return path.join(a,b);}
  fileExists(value){return fs.existsSync(value);}
  createDirectory(value){fs.mkdirSync(value,{recursive:true});}
  writeString(value,content){fs.mkdirSync(path.dirname(value),{recursive:true});fs.writeFileSync(value,content,"utf8");}
  readString(value){return fs.readFileSync(value,"utf8");}
  move(source,destination){if(fs.existsSync(destination))throw new Error(`Destination already exists: ${destination}`);fs.renameSync(source,destination);}
  copy(source,destination){fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);}
  remove(value){fs.rmSync(value,{recursive:true,force:true});}
  isFileDownloaded(){return true;}
  async downloadFileFromiCloud(){}
}
const fm=new TestFileManager();
const opened=[];
class TestAlert {
  addAction(){}
  addCancelAction(){}
  async presentAlert(){return 0;}
}
const installerSource=fs.readFileSync(path.join(root,"Izzy School Signal Installer.js"),"utf8").replaceAll("agattone96","REPLACE_OWNER");
const installerBody=installerSource.slice(0,installerSource.lastIndexOf("try { await install(); }"));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const installerApi=await new AsyncFunction("FileManager","Alert","Safari","Request",`${installerBody};return {install,localManifestFromSource};`)({iCloud:()=>fm},TestAlert,{open:url=>opened.push(url)},class{});
const releaseSource=fs.readFileSync(path.join(root,"Izzy's School Signal.js"),"utf8");
const target=path.join(temporaryRoot,"Izzy's School Signal.js");
fm.writeString(target,releaseSource);
assert.equal(await installerApi.install(),true);
assert.equal(fs.readFileSync(target,"utf8"),releaseSource);
assert.ok(opened[0].includes("scriptable:///run?scriptName="));
const receipt=JSON.parse(fs.readFileSync(path.join(temporaryRoot,"IzzySchoolSignal","installation.json"),"utf8"));
assert.equal(receipt.installedVersion,"15.3.1");
assert.equal(fs.readdirSync(path.join(temporaryRoot,"IzzySchoolSignal")).some(name=>name.includes(".tmp-")||name.includes(".rollback-")),false);

// The in-app updater must move the active script aside before installing and restore it if post-install validation fails.
const updateSource=fs.readFileSync(path.join(root,"src","30-updates.js"),"utf8");
const installStart=updateSource.indexOf("async function installAppUpdate");
const installEnd=updateSource.indexOf("const Presentation",installStart);
assert.ok(installStart>=0&&installEnd>installStart,"in-app updater implementation is present");
const makeUpdater=(validateReleaseSource,saveUpdateState=()=>{})=>new Function("validateUpdateManifest","loadUpdateState","updateIsAvailable","requestUpdateText","validateReleaseSource","FileManager","activeScriptPath","saveUpdateState","APP_INFO",`${updateSource.slice(installStart,installEnd)};return installAppUpdate;`)(
  value=>value,()=>({availableManifest:null}),()=>true,async()=>"new-release",validateReleaseSource,{iCloud:()=>fm},()=>target,saveUpdateState, {id:"izzy-school-signal",version:"15.3.0"}
);
fm.writeString(target,"old-release");
await makeUpdater(()=>{})({version:"14.3.3",build:140303});
assert.equal(fm.readString(target),"new-release");
let validationCalls=0;
await assert.rejects(()=>makeUpdater(()=>{validationCalls++;if(validationCalls===3)throw new Error("post-install validation failed");})({version:"14.3.4",build:140304}),/post-install validation failed/);
assert.equal(fm.readString(target),"new-release","failed update restores the previously active source");
await makeUpdater(()=>{},()=>{throw new Error("metadata unavailable");})({version:"14.3.5",build:140305});
assert.equal(fm.readString(target),"new-release","an installed release remains active if nonessential update metadata cannot be saved");
validationCalls=0;
await assert.rejects(()=>makeUpdater(()=>{validationCalls++;if(validationCalls===3)throw new Error("post-install validation failed");},()=>{throw new Error("metadata unavailable");})({version:"14.3.6",build:140306}),/post-install validation failed/);
assert.equal(fm.readString(target),"new-release","metadata failure does not mask rollback or the original install error");
assert.equal(fs.readdirSync(temporaryRoot).some(name=>name.includes("-stage-")||name.includes("-rollback-")||name==="backups"),false);

fs.rmSync(temporaryRoot,{recursive:true,force:true});
console.log("Recovery-flow tests passed: local installer recovery, no-overwrite updates, and rollback restoration.");
