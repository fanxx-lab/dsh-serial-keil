/**
 * Serial monitor — Host half.
 *
 * Reads one or more serial ports on this machine through PowerShell's
 * `System.IO.Ports.SerialPort`, keeps a bounded line buffer per port, and
 * mirrors every line to the Web client over one SSE route. The same buffer
 * serves the `serial_monitor` tool, so the agent and the user's sidebar watch
 * exactly one reader and never contend for the port.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { createBuildLoop } from './loop.js'

export const name = 'serial-keil'

/** Route prefix owned by this plugin; the client half asks for the same paths. */
const ROUTE = '/plugin-serial-monitor'

/** Defaults for the build loop; a profile patch can override every one of them. */
const DEFAULT_UV4 = 'UV4.exe'
const DEFAULT_SETTLE_MS = 1500

const DEFAULT_BAUD = 115200
const MIN_BAUD = 50
const MAX_BAUD = 4000000
const MAX_LINES = 2000
const MAX_MONITORS = 4
const MAX_TRACKED = 8
const SCAN_TTL_MS = 2000
const MAX_BODY = 16 * 1024
const MAX_STDERR = 4000
const MAX_SEND = 4096

const SHELL_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']

/**
 * Reader run by PowerShell. Environment carries the port and baud, so the
 * command text needs no quoting. Protocol lines start with `::`; received
 * chunks are base64 (`::data`) so the Host can show bytes as ASCII or hex, and
 * `::send64` lines on stdin are written to the port.
 */
const MONITOR_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$stdin = [Console]::OpenStandardInput()
$cmd = New-Object byte[] 512
$task = $null
$acc = New-Object System.Text.StringBuilder
$sp = $null
try {
  Add-Type -AssemblyName System.IO.Ports
  $sp = [System.IO.Ports.SerialPort]::new($env:DSH_SERIAL_PORT, [int]$env:DSH_SERIAL_BAUD)
  $sp.Parity = [System.IO.Ports.Parity]::None
  $sp.DataBits = 8
  $sp.StopBits = [System.IO.Ports.StopBits]::One
  $sp.ReadTimeout = 100
  $sp.Open()
  [Console]::Out.WriteLine('::open')
  [Console]::Out.Flush()
  $buf = New-Object byte[] 4096
  while ($true) {
    $n = 0
    try {
      if ($sp.BytesToRead -gt 0) {
        $want = [Math]::Min($buf.Length, $sp.BytesToRead)
        $n = $sp.Read($buf, 0, $want)
      }
    } catch { $n = 0 }
    if ($n -gt 0) {
      [Console]::Out.WriteLine('::data ' + [Convert]::ToBase64String($buf, 0, $n))
      [Console]::Out.Flush()
    }
    if ($null -eq $task) { $task = $stdin.ReadAsync($cmd, 0, $cmd.Length) }
    if ($task.IsCompleted) {
      $read = 0
      try { $read = $task.Result } catch { $read = 0 }
      if ($read -gt 0) {
        [void]$acc.Append([System.Text.Encoding]::UTF8.GetString($cmd, 0, $read))
        $text = $acc.ToString()
        while ($text.Contains([string][char]10)) {
          $i = $text.IndexOf([char]10)
          $line = $text.Substring(0, $i)
          $text = $text.Substring($i + 1)
          if ($line.StartsWith('::send64 ')) {
            try {
              $bytes = [Convert]::FromBase64String($line.Substring(9))
              $sp.Write($bytes, 0, $bytes.Length)
            } catch { }
          }
        }
        [void]$acc.Clear().Append($text)
      }
      $task = $null
    }
    if ($n -eq 0) { Start-Sleep -Milliseconds 8 }
  }
} catch {
  [Console]::Out.WriteLine('::error ' + $_.Exception.Message)
  [Console]::Out.Flush()
  exit 1
} finally {
  if ($null -ne $sp) { if ($sp.IsOpen) { $sp.Close() } }
}
`

/** Whether a value is a positive safe integer. */
function isBaud(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= MIN_BAUD && value <= MAX_BAUD
}

/** Normalize a requested baud rate. */
function baudOf(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_BAUD
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!isBaud(parsed)) throw new Error(`baud must be an integer between ${String(MIN_BAUD)} and ${String(MAX_BAUD)}`)
  return parsed
}

/** Normalize a requested port name; Windows serial names are case-insensitive. */
function normalizePort(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw.length === 0) throw new Error('port is required, for example COM3')
  if (raw.length > 64) throw new Error('port name is too long')
  if (!/^[A-Za-z0-9_./\\:-]+$/.test(raw)) throw new Error(`port name "${raw}" is not a serial device name`)
  return raw
}

/** The key a port is tracked under. */
function portKeyOf(port) {
  return port.toUpperCase()
}

/** Run one PowerShell command to completion. */
function runShell(shell, command, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(shell, [...SHELL_ARGS, command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      reject(new Error(`${shell} did not finish within ${String(timeoutMs)}ms`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { if (out.length < 65536) out += chunk })
    child.stderr.on('data', (chunk) => { if (err.length < MAX_STDERR) err += chunk })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(err.trim().length > 0 ? err.trim() : `${shell} exited with code ${String(code)}`))
    })
  })
}

/** The monitor roster, its buffers, and the browser subscribers. */
class SerialHub {
  constructor() {
    /** PowerShell used for enumeration and readers; resolved once. */
    this.shell = undefined
    /** Pending shell probe. */
    this.probing = undefined
    /** Monitors keyed by upper-cased port name. */
    this.monitors = new Map()
    /** Last enumeration result. */
    this.ports = []
    this.scannedAt = 0
    this.scanning = undefined
    /** SSE subscribers. */
    this.listeners = new Set()
    /** Open stream closers, ended when the plugin unloads so browsers reconnect. */
    this.streams = new Set()
  }

  /** Resolve a usable PowerShell executable. */
  resolveShell() {
    if (this.shell !== undefined) return Promise.resolve(this.shell)
    if (this.probing === undefined) {
      const candidates = process.platform === 'win32' ? ['pwsh', 'powershell.exe'] : ['pwsh']
      this.probing = (async () => {
        for (const candidate of candidates) {
          try {
            await runShell(candidate, '[Console]::Out.Write("ok")', 15000)
            this.shell = candidate
            return candidate
          } catch { /* try the next executable */ }
        }
        throw new Error('no PowerShell executable was found on this machine')
      })().finally(() => { this.probing = undefined })
    }
    return this.probing
  }

  /** Subscribe a browser connection; the returned function removes it. */
  subscribe(listener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Send one event to every subscriber; a dead connection is dropped by its own route. */
  broadcast(event) {
    for (const listener of [...this.listeners]) {
      try { listener(event) } catch { this.listeners.delete(listener) }
    }
  }

  /** One monitor as JSON: metadata always, buffered lines when asked. */
  view(monitor, withLines) {
    const view = {
      port: monitor.port,
      baud: monitor.baud,
      state: monitor.state,
      error: monitor.error,
      seq: monitor.seq,
      buffered: monitor.lines.length,
    }
    if (withLines === true) view.lines = monitor.lines.slice(-200)
    return view
  }

  /** Snapshot every monitor plus the detected port list, for a fresh subscriber. */
  snapshot(withLines) {
    return {
      ports: this.ports,
      monitors: [...this.monitors.values()].map(monitor => this.view(monitor, withLines)),
    }
  }

  /** Host-side footprint, so a client can tell plugin memory from the rest of the process. */
  runtime() {
    const memory = process.memoryUsage()
    let buffered = 0
    for (const monitor of this.monitors.values()) buffered += monitor.lines.length
    return {
      rssMB: Math.round(memory.rss / 1048576),
      heapUsedMB: Math.round(memory.heapUsed / 1048576),
      monitors: this.monitors.size,
      bufferedLines: buffered,
      subscribers: this.listeners.size,
      streams: this.streams.size,
    }
  }

  /** Read the serial ports this machine exposes. */
  scanPorts(force) {
    if (force !== true && Date.now() - this.scannedAt < SCAN_TTL_MS) return Promise.resolve(this.ports)
    if (this.scanning !== undefined) return this.scanning
    this.scanning = (async () => {
      const shell = await this.resolveShell()
      const out = await runShell(shell,
        'Add-Type -AssemblyName System.IO.Ports; [Console]::Out.Write(([System.IO.Ports.SerialPort]::GetPortNames() -join [char]44))',
        20000)
      const ports = out.split(',').map(port => port.trim()).filter(port => port.length > 0)
      const changed = ports.join(',') !== this.ports.join(',')
      this.ports = ports
      this.scannedAt = Date.now()
      if (changed) this.broadcast({ type: 'ports', ports })
      return ports
    })().catch((error) => {
      this.scannedAt = Date.now()
      throw error
    }).finally(() => { this.scanning = undefined })
    return this.scanning
  }

  /** How many monitors currently hold a port open. */
  liveCount() {
    let live = 0
    for (const monitor of this.monitors.values()) {
      if (monitor.state === 'starting' || monitor.state === 'open') live += 1
    }
    return live
  }

  /** Drop the oldest finished monitor once the roster grows past its bound. */
  prune() {
    if (this.monitors.size <= MAX_TRACKED) return
    const finished = [...this.monitors.values()].filter(monitor => monitor.state !== 'starting' && monitor.state !== 'open')
    finished.sort((left, right) => left.startedAt - right.startedAt)
    for (const monitor of finished.slice(0, this.monitors.size - MAX_TRACKED)) this.monitors.delete(monitor.key)
  }

  /** Start reading a port, or report the monitor already reading it. */
  async start(port, baud) {
    const cleanPort = normalizePort(port)
    const cleanBaud = baudOf(baud)
    const key = portKeyOf(cleanPort)
    const existing = this.monitors.get(key)
    if (existing !== undefined && (existing.state === 'starting' || existing.state === 'open')) {
      return this.view(existing, false)
    }
    if (this.liveCount() >= MAX_MONITORS) {
      throw new Error(`at most ${String(MAX_MONITORS)} ports can be monitored at once; stop one first`)
    }
    const shell = await this.resolveShell()
    this.monitors.delete(key)
    this.prune()
    const monitor = {
      key,
      port: cleanPort,
      baud: cleanBaud,
      state: 'starting',
      error: null,
      lines: [],
      pending: null,
      skipLf: false,
      seq: 0,
      startedAt: Date.now(),
      child: null,
      stderr: '',
    }
    this.monitors.set(key, monitor)
    this.broadcast({ type: 'monitor', monitor: this.view(monitor, false) })
    this.spawnReader(shell, monitor)
    return this.view(monitor, false)
  }

  /** Spawn the PowerShell reader for one monitor. */
  spawnReader(shell, monitor) {
    let child
    try {
      child = spawn(shell, [...SHELL_ARGS, MONITOR_SCRIPT], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, DSH_SERIAL_PORT: monitor.port, DSH_SERIAL_BAUD: String(monitor.baud) },
      })
    } catch (error) {
      this.fail(monitor, error instanceof Error ? error.message : String(error))
      return
    }
    monitor.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const raw = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        this.ingest(monitor, raw.replace(/\r+$/, ''))
        index = buffer.indexOf('\n')
      }
      if (buffer.length > 65536) buffer = buffer.slice(buffer.length - 65536)
    })
    child.stderr.on('data', (chunk) => { monitor.stderr = (monitor.stderr + chunk).slice(-MAX_STDERR) })
    child.on('error', (error) => { this.fail(monitor, error instanceof Error ? error.message : String(error)) })
    child.on('close', (code) => {
      monitor.child = null
      if (monitor.state === 'open') {
        this.setState(monitor, 'closed', code === 0 ? null : (monitor.stderr.trim() || `reader exited with code ${String(code)}`))
      } else if (monitor.state === 'starting') {
        this.setState(monitor, 'error', monitor.stderr.trim() || `reader exited with code ${String(code)} before opening the port`)
      }
    })
  }

  /** Classify one reader line: protocol sentinel or device output. */
  ingest(monitor, line) {
    if (line === '::open') {
      this.setState(monitor, 'open', null)
      return
    }
    if (line.startsWith('::error ')) {
      this.setState(monitor, 'error', line.slice('::error '.length).trim() || 'the port could not be opened')
      return
    }
    if (line.startsWith('::data ')) {
      const chunk = Buffer.from(line.slice('::data '.length).trim(), 'base64')
      if (chunk.length > 0) this.collect(monitor, chunk)
    }
  }

  /** Accumulate received bytes and cut complete lines out of them. */
  collect(monitor, chunk) {
    let buffer = monitor.pending === null ? chunk : Buffer.concat([monitor.pending, chunk])
    if (monitor.skipLf && buffer.length > 0) {
      monitor.skipLf = false
      if (buffer[0] === 0x0a) buffer = buffer.subarray(1)
    }
    for (;;) {
      let cut = -1
      let skip = 1
      for (let index = 0; index < buffer.length; index += 1) {
        const byte = buffer[index]
        if (byte === 0x0a) {
          cut = index
          break
        }
        if (byte === 0x0d) {
          cut = index
          if (index + 1 < buffer.length) skip = buffer[index + 1] === 0x0a ? 2 : 1
          else {
            skip = 1
            monitor.skipLf = true
          }
          break
        }
      }
      if (cut < 0) break
      const line = buffer.subarray(0, cut)
      buffer = buffer.subarray(cut + skip)
      this.pushLine(monitor, line, 'rx')
    }
    if (buffer.length > 8192) {
      this.pushLine(monitor, buffer.subarray(0, 8192), 'rx')
      buffer = buffer.subarray(8192)
    }
    monitor.pending = buffer.length === 0 ? null : buffer
  }

  /** Append one line (received or sent) to the buffer and mirror it. */
  pushLine(monitor, bytes, direction) {
    monitor.seq += 1
    const hex = bytes.toString('hex').toUpperCase().replace(/(..)(?=.)/g, '$1 ')
    const line = {
      seq: monitor.seq,
      at: Date.now(),
      dir: direction === 'tx' ? 'tx' : 'rx',
      text: bytes.toString('utf8'),
      hex,
    }
    monitor.lines.push(line)
    if (monitor.lines.length > MAX_LINES) monitor.lines.splice(0, monitor.lines.length - MAX_LINES)
    this.broadcast({
      type: 'line', port: monitor.port, seq: line.seq, at: line.at,
      dir: line.dir, text: line.text, hex: line.hex,
    })
  }

  /** Write bytes to an open port and echo them into its log. */
  send(port, payload) {
    const cleanPort = normalizePort(port)
    const monitor = this.monitors.get(portKeyOf(cleanPort))
    if (monitor === undefined) throw new Error(`${cleanPort} is not monitored; start it first`)
    if (monitor.state !== 'open' || monitor.child === null) throw new Error(`${cleanPort} is not open`)
    const stdin = monitor.child.stdin
    if (stdin === null || stdin.destroyed) throw new Error(`${cleanPort} cannot accept writes`)
    stdin.write(`::send64 ${payload.toString('base64')}\n`)
    this.pushLine(monitor, payload, 'tx')
    return this.view(monitor, false)
  }

  /** Move one monitor to a new state and publish it. */
  setState(monitor, state, error) {
    monitor.state = state
    monitor.error = error === undefined ? monitor.error : error
    this.broadcast({ type: 'state', port: monitor.port, baud: monitor.baud, state: monitor.state, error: monitor.error })
  }

  /** Report an unexpected failure on one monitor. */
  fail(monitor, message) {
    this.setState(monitor, 'error', message)
  }

  /** Stop reading a port, keeping its buffer. */
  stop(port) {
    const cleanPort = normalizePort(port)
    const monitor = this.monitors.get(portKeyOf(cleanPort))
    if (monitor === undefined) return { port: cleanPort, state: 'idle' }
    const child = monitor.child
    monitor.child = null
    if (child !== null) {
      try { child.kill() } catch { /* already gone */ }
    }
    if (monitor.state === 'starting' || monitor.state === 'open') this.setState(monitor, 'closed', null)
    return this.view(monitor, false)
  }

  /** Empty one buffer without touching the reader. */
  clear(port) {
    const cleanPort = normalizePort(port)
    const monitor = this.monitors.get(portKeyOf(cleanPort))
    if (monitor === undefined) return { port: cleanPort, buffered: 0 }
    monitor.lines = []
    this.broadcast({ type: 'cleared', port: monitor.port })
    return this.view(monitor, false)
  }

  /** The newest buffered lines of one port. */
  read(port, limit, sinceSeq) {
    const cleanPort = normalizePort(port)
    const monitor = this.monitors.get(portKeyOf(cleanPort))
    if (monitor === undefined) return { port: cleanPort, state: 'idle', lines: [], buffered: 0 }
    const count = typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 400) : 40
    const from = typeof sinceSeq === 'number' && Number.isSafeInteger(sinceSeq) && sinceSeq > 0 ? sinceSeq : 0
    const lines = from > 0
      ? monitor.lines.filter(line => line.seq > from).slice(0, 400)
      : monitor.lines.slice(-count)
    return { port: monitor.port, state: monitor.state, baud: monitor.baud, buffered: monitor.lines.length, lines }
  }

  /** Stop every reader; called when the plugin unloads. */
  dispose() {
    for (const monitor of this.monitors.values()) {
      const child = monitor.child
      monitor.child = null
      if (child !== null) {
        try { child.kill() } catch { /* already gone */ }
      }
      monitor.state = 'closed'
    }
    for (const close of [...this.streams]) {
      try { close() } catch { /* already closed */ }
    }
    this.streams.clear()
    this.listeners.clear()
  }
}

/** Write one JSON response. */
function sendJson(res, status, value) {
  if (res.headersSent) return
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Whether a request names an origin other than this one. */
function foreignOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin.length === 0 || origin === 'null') return false
  try {
    return new URL(origin).host !== req.headers.host
  } catch {
    return true
  }
}

/** Read a bounded JSON body. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim().length === 0) {
        resolve({})
        return
      }
      try { resolve(JSON.parse(text)) } catch { reject(new Error('request body is not JSON')) }
    })
    req.on('error', reject)
  })
}

/** Build the bytes one send request asks for. */
function payloadOf(body) {
  if (body === null || typeof body !== 'object') throw new Error('a send request needs a body')
  const encoding = body.encoding === 'hex' ? 'hex' : 'text'
  const data = typeof body.data === 'string' ? body.data : ''
  let bytes
  if (encoding === 'hex') {
    const digits = data.replace(/[^0-9a-fA-F]/g, '')
    if (digits.length === 0) throw new Error('hex data is empty')
    if (digits.length % 2 !== 0) throw new Error('hex data needs an even number of digits')
    bytes = Buffer.from(digits, 'hex')
  } else {
    bytes = Buffer.from(data, 'utf8')
  }
  const ending = typeof body.ending === 'string' ? body.ending : 'none'
  const suffix = ending === 'cr' ? Buffer.from('\r')
    : ending === 'lf' ? Buffer.from('\n')
      : ending === 'crlf' ? Buffer.from('\r\n') : Buffer.alloc(0)
  const payload = Buffer.concat([bytes, suffix])
  if (payload.length === 0) throw new Error('nothing to send')
  if (payload.length > MAX_SEND) throw new Error(`a single write is limited to ${String(MAX_SEND)} bytes`)
  return payload
}

/** One SSE connection fed by the hub. */
function openStream(res, hub, loop) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  if (res.socket !== null && typeof res.socket.setNoDelay === 'function') res.socket.setNoDelay(true)
  const write = (event) => {
    // A page that stops reading must never make the Host buffer without bound: drop lines first.
    if (event.type === 'line' && res.writableLength > 2 * 1024 * 1024) return
    try { res.write(`data: ${JSON.stringify(event)}\n\n`) } catch { /* the connection is gone */ }
  }
  write({ type: 'init', ...hub.snapshot(true), loop: loop.view() })
  const unsubscribe = hub.subscribe(write)
  const beat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { /* the connection is gone */ }
  }, 20000)
  if (typeof beat.unref === 'function') beat.unref()
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    clearInterval(beat)
    unsubscribe()
    hub.streams.delete(close)
    try { res.end() } catch { /* already ended */ }
  }
  hub.streams.add(close)
  res.on('close', close)
}

/**
 * Answer one request under the plugin's route prefix.
 * @param req - HTTP request.
 * @param res - HTTP response.
 * @param hub - the shared monitor roster.
 * @param loop - the build loop driving `UV4`.
 */
async function handleRequest(req, res, hub, loop) {
  if (foreignOrigin(req)) {
    sendJson(res, 403, { error: 'cross-origin requests are refused' })
    return
  }
  const pathname = new URL(String(req.url), 'http://localhost').pathname
  const action = pathname.slice(ROUTE.length)
  const method = req.method === undefined ? 'GET' : req.method.toUpperCase()

  if (method === 'GET' && action === '/stream') {
    openStream(res, hub, loop)
    return
  }
  if (method === 'GET' && action === '/state') {
    sendJson(res, 200, { ...hub.snapshot(true), defaultBaud: DEFAULT_BAUD, loop: loop.view(), runtime: hub.runtime() })
    return
  }
  if (method === 'GET' && action === '/ports') {
    const ports = await hub.scanPorts(true)
    sendJson(res, 200, { ports })
    return
  }
  if (method === 'GET' && action === '/loop/state') {
    sendJson(res, 200, { loop: loop.view() })
    return
  }
  if (method === 'GET' && action === '/loop/projects') {
    sendJson(res, 200, { projects: loop.scanProjects(), current: loop.view().project })
    return
  }
  if (method !== 'POST') {
    sendJson(res, 405, { error: `method ${method} is not allowed here` })
    return
  }
  if (req.headers['x-dsh-serial-monitor'] !== '1') {
    sendJson(res, 403, { error: 'the serial monitor request header is missing' })
    return
  }
  const body = await readJsonBody(req)
  if (action === '/start') {
    const monitor = await hub.start(body.port, body.baud)
    sendJson(res, 200, { monitor })
    return
  }
  if (action === '/stop') {
    sendJson(res, 200, { monitor: hub.stop(body.port) })
    return
  }
  if (action === '/clear') {
    sendJson(res, 200, { monitor: hub.clear(body.port) })
    return
  }
  if (action === '/send') {
    const payload = payloadOf(body)
    sendJson(res, 200, { monitor: hub.send(body.port, payload), bytes: payload.length })
    return
  }
  if (action === '/loop/enable') {
    sendJson(res, 200, { loop: loop.setEnabled(body.enabled === true) })
    return
  }
  if (action === '/loop/autoflash') {
    sendJson(res, 200, { loop: loop.setAutoFlash(body.autoFlash === true) })
    return
  }
  if (action === '/loop/follow') {
    sendJson(res, 200, { loop: loop.setFollow(body.follow === true) })
    return
  }
  if (action === '/loop/run') {
    void loop.run('manual')
    sendJson(res, 200, { loop: loop.view() })
    return
  }
  if (action === '/loop/download') {
    const view = await loop.downloadNow()
    sendJson(res, 200, { loop: view })
    return
  }
  if (action === '/loop/project') {
    sendJson(res, 200, { loop: loop.setProject(body.project) })
    return
  }
  sendJson(res, 404, { error: `unknown action ${action}` })
}

/** Compose the model-facing text for one tool call. */
function describe(read) {
  const head = `${read.port} · ${read.state}${read.baud === undefined ? '' : ` · ${String(read.baud)} baud`} · ${String(read.buffered)} lines buffered`
  if (read.lines.length === 0) return head
  const body = read.lines.map(line => `${String(line.seq).padStart(6, '0')} ${line.dir === 'tx' ? '>' : ' '} ${line.text}`)
  return `${head}\n${body.join('\n')}`
}

/** The `serial_monitor` tool: the same roster the sidebar renders. */
const TOOL = {
  name: 'serial_monitor',
  description: 'Read and write the user\'s serial ports; the user watches the same lines live in the right sidebar, where they can switch between ASCII and hex and type into the port themselves. Actions: "ports" lists detected ports and current monitors; "start" opens a port (port, optional baud, default 115200); "stop" closes one; "read" returns the newest lines of one port (port, optional lines, default 40, max 400, or sinceSeq); "clear" empties one buffer; "send" writes bytes to an open port (port, data, optional encoding text|hex and ending none|cr|lf|crlf), and the written bytes appear in the log marked as sent. The host keeps the port open while monitoring, so never open the same port with another command at the same time. Monitoring keeps running until stopped or the plugin unloads; say which port you used.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['ports', 'start', 'stop', 'read', 'clear', 'send'],
        description: 'ports: list ports and monitors. start: open a port. stop: close one. read: newest lines. clear: empty a buffer. send: write bytes to an open port.',
      },
      port: { type: 'string', description: 'Serial port name, for example COM3. Required except for "ports".' },
      baud: { type: 'integer', description: 'Baud rate for "start". Defaults to 115200.' },
      lines: { type: 'integer', description: 'For "read": how many trailing lines to return. Defaults to 40, at most 400.' },
      sinceSeq: { type: 'integer', description: 'For "read": return only lines with a larger sequence number.' },
      data: { type: 'string', description: 'For "send": the bytes to write, as text unless encoding is "hex".' },
      encoding: { type: 'string', enum: ['text', 'hex'], description: 'For "send": how to read "data". Defaults to text.' },
      ending: { type: 'string', enum: ['none', 'cr', 'lf', 'crlf'], description: 'For "send": bytes appended after the data. Defaults to none.' },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
    render(_args, value) {
      return [{ type: 'text', text: value.text }]
    },
  },
}

/** Model-facing summary of the build loop. */
function describeLoop(view) {
  const open = (view.keil?.windows ?? []).map(window => window.project).filter(project => typeof project === 'string')
  const head = [
    `project: ${view.project}`,
    `auto rounds: ${view.enabled ? 'on' : 'off'} · follow Keil: ${view.follow ? 'on' : 'off'} · download after build: ${view.autoFlash ? 'auto' : 'manual'} · phase: ${view.phase}`,
    `serial port: ${view.port === '' ? 'none' : view.port}`,
    `keil open: ${open.length === 0 ? 'no IDE project detected' : open.join(', ')}`,
    `debugger: ${view.keil?.driver || 'unknown'} · flasher: ${view.keil?.flasher || 'unknown'} · probes: ${(view.keil?.probes ?? []).join(', ') || 'none detected'}`,
  ]
  const last = view.last
  if (last === null) return [...head, 'no build has run yet'].join('\n')
  const stamp = new Date(last.at).toLocaleTimeString()
  const state = last.pending === true
    ? 'built, waiting for download'
    : last.ok ? 'OK' : last.buildOk ? 'download failed' : 'build failed'
  const counts = last.errors === undefined
    ? 'no error summary'
    : `${String(last.errors)} error(s), ${String(last.warnings ?? 0)} warning(s)`
  const times = `build ${(last.buildMs / 1000).toFixed(1)}s${last.flashMs === 0 ? '' : ` · download ${(last.flashMs / 1000).toFixed(1)}s`}`
  const lines = [...head, `last run ${stamp} · ${state} · ${counts} · ${times}`]
  if (last.message !== null && last.message !== undefined) lines.push(`note: ${last.message}`)
  if (last.errorLines !== undefined && last.errorLines.length > 0) {
    lines.push('errors:')
    lines.push(...last.errorLines.slice(0, 20))
  }
  if (!last.buildOk && last.buildTail !== undefined && last.buildTail.length > 0) {
    lines.push('build log tail:')
    lines.push(...last.buildTail.slice(-10))
  }
  if (last.buildOk && !last.flashOk && last.flashTail !== undefined && last.flashTail.length > 0) {
    lines.push('download log tail:')
    lines.push(...last.flashTail.slice(-8))
  }
  return lines.join('\n')
}

/** The `build_flash` tool: one Keil round, judged by the build log. */
const BUILD_TOOL = {
  name: 'build_flash',
  description: 'Build the Keil project this plugin watches, check the build log for errors, and download the firmware (automatically after a successful build, or with "download" when automatic download is off). It also reports which project the Keil IDE currently shows, the configured debugger, the plugged-in probe, and whether the last download connected, and it refuses a download while the IDE shows a different project. The loop also runs by itself after saved source changes; this tool reports its state or starts one round on demand, so use it after editing firmware sources instead of starting Keil by hand. Actions: "status", "run" (build now and wait), "download" (flash the last successful build), "enable"/"disable" (automatic rounds), "autoflash" (set automatic download from autoFlash), "follow" (follow the project the IDE shows from follow), "projects", "project".',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'run', 'download', 'enable', 'disable', 'autoflash', 'follow', 'projects', 'project'],
        description: 'status: current state, IDE project, debugger and last result. run: one build round. download: flash the last successful build. enable/disable: automatic rounds. autoflash: automatic download on or off. follow: follow the IDE project. projects: list .uvprojx files. project: switch the watched project.',
      },
      project: { type: 'string', description: 'For "project": absolute path to a .uvprojx file.' },
      autoFlash: { type: 'boolean', description: 'For "autoflash": download automatically after a successful build.' },
      follow: { type: 'boolean', description: 'For "follow": keep the loop on the project the Keil IDE currently shows.' },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
    render(_args, value) {
      return [{ type: 'text', text: value.text }]
    },
  },
}

/**
 * Mount the serial hub, its SSE route, and the agent tools.
 * @param ctx - Host plugin context.
 * @param config - Optional loop settings from the profile patch.
 */
export function apply(ctx, config) {
  const settings = config ?? {}
  const hub = new SerialHub()
  ctx.effect(() => () => { hub.dispose() }, 'serial-monitor: readers')

  const project = typeof settings.project === 'string' ? settings.project : ''
  const loop = createBuildLoop({
    hub,
    uv4: typeof settings.uv4 === 'string' && settings.uv4.length > 0 ? settings.uv4 : DEFAULT_UV4,
    project,
    root: typeof settings.root === 'string' && settings.root.length > 0
      ? settings.root
      : (project.length > 0 ? path.resolve(path.dirname(project), '..', '..', '..') : ''),
    settleMs: Number.isSafeInteger(settings.settleMs) ? settings.settleMs : DEFAULT_SETTLE_MS,
    autoFlash: settings.autoFlash !== false,
    auto: settings.auto !== false,
    follow: settings.follow !== false,
    guard: settings.guard !== false,
    port: typeof settings.port === 'string' ? settings.port : '',
    baud: Number.isSafeInteger(settings.baud) ? settings.baud : DEFAULT_BAUD,
  })
  loop.activate()
  ctx.effect(() => () => { loop.dispose() }, 'serial-monitor: build loop')

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: (req, res) => {
        handleRequest(req, res, hub, loop).catch((error) => {
          if (res.headersSent) res.destroy()
          else sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        })
      },
    }), `serial-monitor: ${ROUTE}`)
  })

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => {
      const disposeSerial = toolCtx.tools.register({
        ...TOOL,
        async execute(args) {
          const action = typeof args?.action === 'string' ? args.action : ''
          if (action === 'ports') {
            const ports = await hub.scanPorts(true).catch(() => [])
            const lines = ports.length === 0
              ? 'No serial ports were detected.'
              : `Detected ports: ${ports.join(', ')}`
            const monitors = [...hub.monitors.values()]
              .map(monitor => `${monitor.port} · ${monitor.state} · ${String(monitor.baud)} baud · ${String(monitor.lines.length)} lines buffered`)
            return { text: [lines, monitors.length === 0 ? 'No port is being monitored.' : `Monitors:\n${monitors.join('\n')}`].join('\n') }
          }
          if (action === 'start') {
            const monitor = await hub.start(args.port, args.baud)
            const text = `${monitor.port} is being read at ${String(monitor.baud)} baud; the user watches the same lines in the right sidebar under "Serial monitor".`
            return { text }
          }
          if (action === 'stop') {
            const monitor = hub.stop(args.port)
            return { text: `${monitor.port} is no longer monitored.` }
          }
          if (action === 'read') {
            const read = hub.read(args.port, args.lines, args.sinceSeq)
            return { text: describe(read) }
          }
          if (action === 'clear') {
            const monitor = hub.clear(args.port)
            return { text: `Cleared the ${monitor.port} buffer.` }
          }
          if (action === 'send') {
            const payload = payloadOf({ port: args.port, data: args.data, encoding: args.encoding, ending: args.ending })
            const monitor = hub.send(args.port, payload)
            const hex = payload.toString('hex').toUpperCase().replace(/(..)(?=.)/g, '$1 ')
            return { text: `Sent ${String(payload.length)} byte(s) to ${monitor.port}: ${hex}` }
          }
          throw new Error(`unknown action "${action}"; use ports, start, stop, read, clear, or send`)
        },
      })
      const disposeBuild = toolCtx.tools.register({
        ...BUILD_TOOL,
        async execute(args) {
          const action = typeof args?.action === 'string' ? args.action : ''
          if (action === 'status') return { text: describeLoop(loop.view()) }
          if (action === 'run') {
            await loop.run('tool')
            return { text: describeLoop(loop.view()) }
          }
          if (action === 'download') {
            await loop.downloadNow()
            return { text: describeLoop(loop.view()) }
          }
          if (action === 'enable') {
            loop.setEnabled(true)
            return { text: describeLoop(loop.view()) }
          }
          if (action === 'disable') {
            loop.setEnabled(false)
            return { text: describeLoop(loop.view()) }
          }
          if (action === 'autoflash') {
            loop.setAutoFlash(args.autoFlash !== false)
            return { text: describeLoop(loop.view()) }
          }
          if (action === 'follow') {
            loop.setFollow(args.follow !== false)
            return { text: describeLoop(loop.view()) }
          }
          if (action === 'projects') {
            const projects = loop.scanProjects()
            return { text: projects.length === 0 ? 'No .uvprojx file was found under the configured root.' : projects.join('\n') }
          }
          if (action === 'project') {
            loop.setProject(args.project)
            return { text: describeLoop(loop.view()) }
          }
          throw new Error(`unknown action "${action}"; use status, run, download, enable, disable, autoflash, follow, projects, or project`)
        },
      })
      return () => {
        disposeBuild()
        disposeSerial()
      }
    }, 'serial-monitor: tools')
  })
}

