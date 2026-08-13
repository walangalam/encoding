import {
  AudioInputSource,
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

const MAIN_ID = 1
const MAIN_NAME = 'alyxvoice'
const UI_THROTTLE_MS = 250
const AUTO_FALLBACK_MS = 3000

const bridge = await waitForEvenAppBridge()

type MicState = 'OFF' | 'STARTING' | 'LIVE' | 'FAILED'
let micState: MicState = 'OFF'
let shuttingDown = false
let lastUiUpdate = 0
let packetCount = 0
let lastDb = -96
let pressCount = 0
let lastEvent = 'startup'
let lastAction = 'Ready'
let audioResult: 'n/a' | 'true' | 'false' | 'error' = 'n/a'
let lastError = ''

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

function pcm16RmsDb(pcm: Uint8Array): number {
  const evenLength = pcm.byteLength - (pcm.byteLength % 2)
  if (evenLength < 2) return -96
  const view = new DataView(pcm.buffer, pcm.byteOffset, evenLength)
  const sampleCount = evenLength / 2
  let sumSquares = 0
  for (let offset = 0; offset < evenLength; offset += 2) {
    const sample = view.getInt16(offset, true) / 32768
    sumSquares += sample * sample
  }
  const rms = Math.sqrt(sumSquares / sampleCount)
  if (rms <= 0) return -96
  return Math.max(-96, 20 * Math.log10(rms))
}

function meter(db: number): string {
  const normalized = Math.max(0, Math.min(1, (db + 60) / 60))
  const bars = Math.round(normalized * 10)
  return `${'|'.repeat(bars)}${'.'.repeat(10 - bars)}`
}

function screenText(): string {
  const lines = [
    'ALYX G2 VOICE 0.1.1',
    `MIC: ${micState}  press:${pressCount}`,
    `audioControl: ${audioResult}`,
    `Last: ${lastAction}`,
  ]
  if (micState === 'LIVE') {
    lines.push(`Voice:${meter(lastDb)} ${lastDb.toFixed(0)}dB`)
    lines.push(`Frames:${packetCount}`)
    lines.push('Press=pause  Double=exit')
  } else if (micState === 'FAILED') {
    lines.push(lastError ? `Err:${lastError.slice(0, 52)}` : 'Mic request returned false')
    lines.push('Press retries mic')
    lines.push('Double=exit')
  } else {
    lines.push(`Event:${lastEvent}`)
    lines.push('Press=start mic')
    lines.push('No press? auto-test in 3s')
  }
  return lines.join('\n')
}

async function render(): Promise<boolean> {
  try {
    const ok = await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: MAIN_ID, containerName: MAIN_NAME, content: screenText() }),
    )
    if (!ok) console.warn('textContainerUpgrade returned false')
    return ok
  } catch (err) {
    console.error('textContainerUpgrade failed', err)
    return false
  }
}

async function startMic(origin: string): Promise<void> {
  if (micState === 'STARTING' || micState === 'LIVE' || shuttingDown) return
  micState = 'STARTING'
  audioResult = 'n/a'
  lastError = ''
  packetCount = 0
  lastDb = -96
  lastAction = `${origin}: mic request`
  await render()
  try {
    const ok = await bridge.audioControl(true, AudioInputSource.Glasses)
    audioResult = ok ? 'true' : 'false'
    micState = ok ? 'LIVE' : 'FAILED'
    lastAction = ok ? `${origin}: MIC LIVE` : `${origin}: MIC FAILED`
    if (!ok) lastError = 'audioControl returned false'
  } catch (err) {
    audioResult = 'error'
    micState = 'FAILED'
    lastError = err instanceof Error ? err.message : String(err)
    lastAction = `${origin}: exception`
  }
  await render()
}

async function stopMic(origin: string): Promise<void> {
  if (micState !== 'LIVE') return
  try {
    const ok = await bridge.audioControl(false)
    lastAction = `${origin}: stop ${ok ? 'OK' : 'false'}`
  } catch (err) {
    lastAction = `${origin}: stop error`
    lastError = err instanceof Error ? err.message : String(err)
  }
  micState = 'OFF'
  audioResult = 'n/a'
  await render()
}

async function toggleMic(origin: string): Promise<void> {
  if (micState === 'LIVE') await stopMic(origin)
  else await startMic(origin)
}

async function cleanup(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  try { await bridge.audioControl(false) } catch {}
  micState = 'OFF'
}

const startup = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 6,
  containerID: MAIN_ID,
  containerName: MAIN_NAME,
  content: screenText(),
  isEventCapture: 1,
})

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [startup] }),
)
if (created !== 0) throw new Error(`createStartUpPageContainer failed: ${created}`)

const unsubscribe = bridge.onEvenHubEvent((event) => {
  const pcm = event.audioEvent?.audioPcm
  if (micState === 'LIVE' && pcm) {
    packetCount += 1
    lastDb = pcm16RmsDb(pcm)
    const now = performance.now()
    if (now - lastUiUpdate >= UI_THROTTLE_MS) {
      lastUiUpdate = now
      void render()
    }
  }

  const sysType = eventTypeOf(event.sysEvent)
  const textType = eventTypeOf(event.textEvent)
  if (sysType !== null) lastEvent = `sys:${String(event.sysEvent?.eventType ?? 0)}`
  else if (textType !== null) lastEvent = `text:${String(event.textEvent?.eventType ?? 0)}`

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    lastAction = 'DOUBLE PRESS RECEIVED'
    void cleanup().finally(() => { unsubscribe(); bridge.shutDownPageContainer(1) })
    return
  }
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    void cleanup().finally(unsubscribe)
    return
  }
  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    pressCount += 1
    lastAction = 'PRESS RECEIVED'
    void render().then(() => toggleMic('PRESS'))
  }
})

window.addEventListener('beforeunload', () => { void cleanup() })
await render()
window.setTimeout(() => {
  if (pressCount === 0 && micState === 'OFF' && !shuttingDown) {
    lastAction = 'NO PRESS - AUTO TEST'
    void startMic('AUTO')
  }
}, AUTO_FALLBACK_MS)
