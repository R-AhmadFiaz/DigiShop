const {spawn,execFileSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const win=process.platform==='win32';
const children=new Set();
let stopping=false;
function stop(){if(stopping)return;stopping=true;for(const child of children){if(win){try{execFileSync('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}else child.kill('SIGTERM');}}
process.on('SIGINT',()=>{stop();process.exitCode=130;});
process.on('SIGTERM',()=>{stop();process.exitCode=143;});
function run(app,task,extra={}){return new Promise((resolve,reject)=>{
 const args=task==='ci'?['ci']:['run',task];
 if(task==='dev'&&app==='frontend'&&process.env.FRONTEND_PORT){if(!/^\d+$/.test(process.env.FRONTEND_PORT))return reject(Error('Invalid FRONTEND_PORT'));args.push('--','--port',process.env.FRONTEND_PORT);}
 const child=win?spawn(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm.cmd '+args.join(' ')],{cwd:path.join(root,app),env:{...process.env,...extra},stdio:'inherit',windowsHide:true}):spawn('npm',args,{cwd:path.join(root,app),env:{...process.env,...extra},stdio:'inherit'});
 children.add(child);child.on('error',reject);child.on('exit',(code,signal)=>{children.delete(child);if(code===0||stopping)resolve();else reject(Error(app+' '+task+' exited '+(code??signal)));});
});}
const backendEnv={PORT:process.env.PORT||'3001',CORS_ORIGIN:process.env.CORS_ORIGIN||'http://localhost:'+(process.env.FRONTEND_PORT||'5173')};
const frontendEnv={VITE_API_BASE_URL:process.env.VITE_API_BASE_URL||'http://localhost:'+(process.env.PORT||'3001')+'/api/v2'};
const testEnv={NODE_ENV:'test',DOTENV_CONFIG_PATH:path.join(root,'.migration-local','no-test-env'),MONGO_DB_URI:'mongodb://127.0.0.1:1',OPENAI_API_KEY:'test-only',ACCESS_TOKEN_SECRET:'local-test-access',REFRESH_TOKEN_SECRET:'local-test-refresh',ACCESS_TOKEN_EXPIRY:'15m',REFRESH_TOKEN_EXPIRY:'7d',NODE_OPTIONS:((process.env.NODE_OPTIONS||'')+' --require="'+path.join(__dirname,'test-network-guard.cjs').replaceAll(String.fromCharCode(92),'/')+'"').trim()};
async function main(){switch(process.argv[2]){
 case 'install':await run('frontend','ci');await run('backend','ci');break;
 case 'build':await run('frontend','build');await run('backend','build');break;
 case 'test':await run('frontend','test',testEnv);await run('backend','test',testEnv);break;
 case 'dev:frontend':await run('frontend','dev',frontendEnv);break;
 case 'dev:backend':await run('backend','dev',backendEnv);break;
 case 'dev':await Promise.race([run('frontend','dev',frontendEnv),run('backend','dev',backendEnv)]);stop();break;
 default:throw Error('Unknown command');
}}
main().catch(error=>{console.error(error.message);stop();process.exitCode=1;});
