import {AudioInputSource,CreateStartUpPageContainer,OsEventTypeList,TextContainerProperty,TextContainerUpgrade,waitForEvenAppBridge} from '@evenrealities/even_hub_sdk'

const bridge = await waitForEvenAppBridge()
const ID=1, NAME='alyxvoice', URL='wss://ramurgamefix.com/alyx-g2-voice'
let ws:WebSocket|null=null, mic=false, mode:'wake'|'ptt'='wake', state='CONNECTING', partial='', finalText='', reply='', wakeSeen=false, frames=0, lastDb=-96, lastVoice=0, press=0, lastRender=0

function evt(e?:{eventType?:OsEventTypeList}){return e ? (e.eventType ?? OsEventTypeList.CLICK_EVENT) : null}
function db(p:Uint8Array){const n=p.byteLength-p.byteLength%2;if(n<2)return -96;const v=new DataView(p.buffer,p.byteOffset,n);let s=0;for(let i=0;i<n;i+=2){const x=v.getInt16(i,true)/32768;s+=x*x}const r=Math.sqrt(s/(n/2));return r>0?Math.max(-96,20*Math.log10(r)):-96}
function text(){const body=reply||partial||finalText||'Say “Alyx…” or press temple';return ['ALYX VOICE 0.2.0',`NET:${ws?.readyState===1?'OK':'--'} MIC:${mic?'ON':'OFF'} ${mode.toUpperCase()}`,`STATE:${state}`,body.slice(-190),`frames:${frames} press:${press}`].join('\n')}
async function render(){const now=performance.now();if(now-lastRender<140)return;lastRender=now;await bridge.textContainerUpgrade(new TextContainerUpgrade({containerID:ID,containerName:NAME,content:text()})).catch(()=>{})}
function sendJson(o:unknown){if(ws?.readyState===1)ws.send(JSON.stringify(o))}
function connect(){state='CONNECTING';ws=new WebSocket(URL);ws.binaryType='arraybuffer';ws.onopen=()=>{state='READY';sendJson({type:'hello',client:'g2',version:'0.2.0'});void startMic();void render()};ws.onmessage=e=>{if(typeof e.data!=='string')return;try{const m=JSON.parse(e.data);if(m.type==='partial'){partial=m.text||'';if(/\balyx\b/i.test(partial)){wakeSeen=true;state='WAKE HEARD'}}else if(m.type==='final'){finalText=m.text||'';partial='';state='THINKING'}else if(m.type==='reply'){reply=m.text||'';state='READY';wakeSeen=false;finalText=''}else if(m.type==='error'){reply=`ERROR: ${m.message}`;state='ERROR'}void render()}catch{}};ws.onclose=()=>{state='OFFLINE';void render();setTimeout(connect,2500)};ws.onerror=()=>{state='NET ERROR';void render()}}
async function startMic(){if(mic)return;state='MIC START';void render();const ok=await bridge.audioControl(true,AudioInputSource.Glasses).catch(()=>false);mic=!!ok;state=mic?'LISTENING':'MIC FAILED';sendJson({type:'mode',mode});void render()}
async function stopMic(){if(!mic)return;await bridge.audioControl(false).catch(()=>false);mic=false;void render()}
function beginPtt(){mode='ptt';reply='';partial='';finalText='';wakeSeen=true;state='PTT LISTEN';sendJson({type:'start',mode:'ptt'});void render()}
function endUtterance(){sendJson({type:'end'});state='TRANSCRIBING';void render()}

const startup=new TextContainerProperty({xPosition:0,yPosition:0,width:576,height:288,borderWidth:0,borderColor:5,paddingLength:6,containerID:ID,containerName:NAME,content:text(),isEventCapture:1})
const created=await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({containerTotalNum:1,textObject:[startup]}));if(created!==0)throw new Error(`startup failed ${created}`)

const unsub=bridge.onEvenHubEvent(e=>{
 const pcm=e.audioEvent?.audioPcm;if(mic&&pcm){frames++;lastDb=db(pcm);if(lastDb>-42)lastVoice=performance.now();if(ws?.readyState===1)ws.send(pcm);if(mode==='wake'&&wakeSeen&&performance.now()-lastVoice>1300){endUtterance();wakeSeen=false}void render()}
 const s=evt(e.sysEvent),t=evt(e.textEvent)
 if(s===OsEventTypeList.DOUBLE_CLICK_EVENT||t===OsEventTypeList.DOUBLE_CLICK_EVENT){void stopMic().finally(()=>{unsub();bridge.shutDownPageContainer(1)});return}
 if(s===OsEventTypeList.CLICK_EVENT||t===OsEventTypeList.CLICK_EVENT){press++;if(mode==='ptt'&&state==='PTT LISTEN'){endUtterance();mode='wake';sendJson({type:'mode',mode:'wake'})}else beginPtt();void render()}
 if(s===OsEventTypeList.SYSTEM_EXIT_EVENT||s===OsEventTypeList.ABNORMAL_EXIT_EVENT){void stopMic().finally(unsub)}
})
window.addEventListener('beforeunload',()=>{ws?.close();void stopMic()})
connect();await render()
