import {AudioInputSource,CreateStartUpPageContainer,OsEventTypeList,TextContainerProperty,TextContainerUpgrade,waitForEvenAppBridge} from '@evenrealities/even_hub_sdk'
import {BRIDGE_TOKEN,BRIDGE_WS_URL,RECONNECT_MS,SILENCE_MS,VOICE_DB_THRESHOLD,WAKE_WORD} from './config'

const bridge=await waitForEvenAppBridge(),ID=1,NAME='alyxvoice'
type Mode='wake'|'ptt'
type State='CONNECTING'|'AUTH'|'READY'|'LISTENING'|'WAKE HEARD'|'PTT LISTEN'|'TRANSCRIBING'|'THINKING'|'OFFLINE'|'NET ERROR'|'MIC FAILED'|'ERROR'
let ws:WebSocket|null=null,mic=false,mode:Mode='wake',state:State='CONNECTING',partial='',finalText='',reply='',wakeSeen=false,frames=0,lastDb=-96,lastVoice=0,press=0,lastRender=0,shuttingDown=false

function evt(e?:{eventType?:OsEventTypeList}){return e?(e.eventType??OsEventTypeList.CLICK_EVENT):null}
function db(p:Uint8Array){const n=p.byteLength-p.byteLength%2;if(n<2)return -96;const v=new DataView(p.buffer,p.byteOffset,n);let s=0;for(let i=0;i<n;i+=2){const x=v.getInt16(i,true)/32768;s+=x*x}const r=Math.sqrt(s/(n/2));return r>0?Math.max(-96,20*Math.log10(r)):-96}
function text(){const body=reply||partial||finalText||`Say “${WAKE_WORD}…” or press temple`;return ['ALYX VOICE 0.2.2',`NET:${ws?.readyState===WebSocket.OPEN?'OK':'--'} MIC:${mic?'ON':'OFF'} ${mode.toUpperCase()}`,`STATE:${state}`,body.slice(-190),`frames:${frames} press:${press}`].join('\n')}
async function render(force=false){const now=performance.now();if(!force&&now-lastRender<140)return;lastRender=now;await bridge.textContainerUpgrade(new TextContainerUpgrade({containerID:ID,containerName:NAME,content:text()})).catch(()=>{})}
function sendJson(o:unknown){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(o))}
async function startMic(){if(mic||shuttingDown)return;const ok=await bridge.audioControl(true,AudioInputSource.Glasses).catch(()=>false);mic=!!ok;state=mic?'LISTENING':'MIC FAILED';await render(true)}
async function stopMic(){if(!mic)return;await bridge.audioControl(false).catch(()=>false);mic=false;await render(true)}
function beginPtt(){mode='ptt';reply='';partial='';finalText='';wakeSeen=false;state='PTT LISTEN';sendJson({type:'start',mode:'ptt'});void render(true)}
function endUtterance(){if(state==='TRANSCRIBING'||state==='THINKING')return;sendJson({type:'end'});state='TRANSCRIBING';wakeSeen=false;void render(true)}
function connect(){if(shuttingDown)return;state='CONNECTING';void render(true);ws=new WebSocket(BRIDGE_WS_URL);ws.binaryType='arraybuffer';ws.onopen=()=>{state='AUTH';sendJson({type:'hello',client:'g2',version:'0.2.2',token:BRIDGE_TOKEN});void render(true)};ws.onmessage=e=>{if(typeof e.data!=='string')return;try{const m=JSON.parse(e.data) as {type?:string;text?:string;message?:string};if(m.type==='ready'){state='READY';mode='wake';sendJson({type:'start',mode:'wake'});void startMic()}else if(m.type==='partial'){partial=m.text??'';if(new RegExp(`\\b${WAKE_WORD}\\b`,'i').test(partial)){wakeSeen=true;state='WAKE HEARD'}}else if(m.type==='final'){finalText=m.text??'';partial='';state='THINKING'}else if(m.type==='reply'){reply=m.text??'';finalText='';partial='';wakeSeen=false;mode='wake';state='READY';sendJson({type:'start',mode:'wake'})}else if(m.type==='error'){reply=`ERROR: ${m.message??'unknown'}`;state='ERROR'}void render(true)}catch{}};ws.onclose=()=>{if(shuttingDown)return;state='OFFLINE';void render(true);window.setTimeout(connect,RECONNECT_MS)};ws.onerror=()=>{state='NET ERROR';void render(true)}}

const startup=new TextContainerProperty({xPosition:0,yPosition:0,width:576,height:288,borderWidth:0,borderColor:5,paddingLength:6,containerID:ID,containerName:NAME,content:text(),isEventCapture:1})
const created=await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({containerTotalNum:1,textObject:[startup]}));if(created!==0)throw new Error(`createStartUpPageContainer failed: ${created}`)

const unsub=bridge.onEvenHubEvent(e=>{
 const pcm=e.audioEvent?.audioPcm
 if(mic&&pcm){frames++;lastDb=db(pcm);if(lastDb>VOICE_DB_THRESHOLD)lastVoice=performance.now();if(ws?.readyState===WebSocket.OPEN)ws.send(pcm);if(mode==='wake'&&wakeSeen&&lastVoice>0&&performance.now()-lastVoice>SILENCE_MS)endUtterance();void render()}
 const s=evt(e.sysEvent),t=evt(e.textEvent)
 if(s===OsEventTypeList.DOUBLE_CLICK_EVENT||t===OsEventTypeList.DOUBLE_CLICK_EVENT){shuttingDown=true;ws?.close();void stopMic().finally(()=>{unsub();bridge.shutDownPageContainer(1)});return}
 if(s===OsEventTypeList.CLICK_EVENT||t===OsEventTypeList.CLICK_EVENT){press++;if(mode==='ptt'&&state==='PTT LISTEN'){endUtterance();mode='wake'}else if(state!=='TRANSCRIBING'&&state!=='THINKING')beginPtt();void render(true)}
 if(s===OsEventTypeList.SYSTEM_EXIT_EVENT||s===OsEventTypeList.ABNORMAL_EXIT_EVENT){shuttingDown=true;ws?.close();void stopMic().finally(unsub)}
})
window.addEventListener('beforeunload',()=>{shuttingDown=true;ws?.close();void stopMic()})
connect();await render(true)
