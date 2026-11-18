/**
 * Build loop — Host half.
 *
 * Watches one Keil project's sources, and after edits settle runs
 * `UV4 -b` and then `UV4 -f` (flash download) through the command line. A round
 * is judged by the build log alone: any compiler error stops the round before
 * the download. After a successful download the serial monitor is reopened for
 * the configured port, so the boot output continues in the sidebar.
 *
 * The loop also watches the Keil IDE itself (`tasklist` window titles) and the
 * debug probe list (`pnputil`), so a round never downloads to a project the IDE
 * is not showing and the panel can report which debugger is configured, that a
 * probe is plugged in, and whether the last download actually connected.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Source extensions that start a round. */
const WATCHED_EXTENSIONS = new Set(['.c', '.h', '.s', '.cpp', '.hpp', '.cxx', '.uvprojx', '.sct'])

/** Path segments that never start a round. */
const IGNORED_SEGMENTS = ['\\objects\\', '\\listings\\', '\\.git\\', '\\node_modules\\', '\\rte\\', '\\.vs\\', '\\dsh-plugins\\', '\\demo\\']

const BUILD_TIMEOUT_MS = 240000
const FLASH_TIMEOUT_MS = 180000
const PROCESS_TIMEOUT_MS = 15000
const HISTORY_LIMIT = 8
const TAIL_LINES = 30
const KEIL_POLL_MS = 5000
const PROBE_POLL_MS = 30000

/** Device-description words that mean a debug probe. */
const PROBE_PATTERN = /(cmsis[- ]?dap|st-?link|j-?link|ulink|daplink|black magic)/i

/** Whether a relative path inside the project should start a round. */
function isSourcePath(relative) {
  const normalized = `\\${relative.toLowerCase().replace(/\//g, '\\')}\\`
  if (IGNORED_SEGMENTS.some(segment => normalized.includes(segment))) return false
  return WATCHED_EXTENSIONS.has(path.extname(relative).toLowerCase())
}

/** Decode console output written in the machine's ANSI code page. */
function decodeConsole(buffer) {
  try {
    return new TextDecoder('gbk').decode(buffer)
  } catch {
    return buffer.toString('utf8')
  }
}

/** Same path, whatever the separators or case. */
function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

/** A file's tail lines, keeping non-empty ones. */
function tailOf(text, limit) {
  return text.split(/\r?\n/).map(line => line.trimRight()).filter(line => line.length > 0).slice(-limit)
}

/** Interpret a `UV4 -b` run. */
function parseBuild(exit, log) {
  const summary = /(\d+)\s+Error\(s\),\s+(\d+)\s+Warning\(s\)/.exec(log)
  const errors = summary === null ? undefined : Number(summary[1])
  const warnings = summary === null ? undefined : Number(summary[2])
  const errorLines = log.split(/\r?\n/)
    .filter(line => /\berror:|\bError:|#error|undefined symbol|A\d{4}[EW]:|L6\d{3}[EW]:/i.test(line))
    .slice(0, 40)
  return { ok: exit === 0 && errors === 0, exit, errors, warnings, errorLines, tail: tailOf(log, TAIL_LINES) }
}

/** Interpret a `UV4 -f` run. */
function parseFlash(exit, log) {
  return { ok: exit === 0 && /Flash Load finished/i.test(log), exit, tail: tailOf(log, TAIL_LINES) }
}

/** Run a command and collect its raw output. */
function runProcess(file, args, timeoutMs) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ exit: -1, stdout: Buffer.alloc(0), stderr: Buffer.from(String(error)) })
      return
    }
    const out = []
    const err = []
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
    }, timeoutMs)
    child.stdout.on('data', chunk => out.push(chunk))
    child.stderr.on('data', chunk => err.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ exit: -1, stdout: Buffer.concat(out), stderr: Buffer.from(String(error)) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exit: typeof code === 'number' ? code : -1, stdout: Buffer.concat(out), stderr: Buffer.concat(err) })
    })
  })
}

/** The `tasklist /v` rows of UV4: the IDE window and the project it shows. */
function parseKeilWindows(text) {
  const windows = []
  const seen = new Set()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('"UV4')) continue
    const fields = line.split('","')
    if (fields.length < 2) continue
    const pid = Number(fields[1])
    const title = fields[fields.length - 1].replace(/"$/, '')
    const match = /([A-Za-z]:\\[^"]*?\.uvprojx)/i.exec(title)
    const project = match === null ? null : match[1]
    // A command-line UV4 briefly shows the same project while it flashes; report each project once.
    if (project !== null) {
      const key = project.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
    }
    windows.push({
      pid: Number.isSafeInteger(pid) ? pid : 0,
      title,
      project,
    })
  }
  return windows
}

/** The plugged-in debug probes from `pnputil /enum-devices /connected`. */
function parseProbes(text) {
  const probes = []
  for (const line of text.split(/\r?\n/)) {
    // The field label is localized (设备描述:, Device Description:), so only the value is read.
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const value = line.slice(colon + 1).trim()
    if (value.length === 0 || value.includes('\\') || !PROBE_PATTERN.test(value)) continue
    if (!probes.includes(value)) probes.push(value)
  }
  return probes
}

/** What one project says about its debugger and flash algorithm. */
function parseProjectDebug(file) {
  try {
    const text = new TextDecoder('gbk').decode(fs.readFileSync(file))
    const target = /<TargetDllName>([^<]*)<\/TargetDllName>/.exec(text)
    const flash = /<Flash2>([^<]*)<\/Flash2>/.exec(text)
    return {
      driver: target === null ? '' : target[1].trim(),
      flasher: flash === null ? '' : flash[1].trim(),
    }
  } catch {
    return { driver: '', flasher: '' }
  }
}

/** The watched project's state machine. */
export function createBuildLoop(options) {
  const hub = options.hub
  const uv4 = options.uv4
  const settleMs = options.settleMs
  const monitorPort = options.port
  const monitorBaud = options.baud

  let project = options.project
  let root = options.root
  let watcher = null
  let debounce = null
  let running = false
  let queued = false
  let disposed = false
  let keilTimer = null
  let probeTimer = null
  let polling = false
  let projectDebugCache = { file: null, mtimeMs: 0, driver: '', flasher: '' }
  const pendingFiles = new Set()

  /** What both surfaces render. */
  const state = {
    enabled: options.auto !== false,
    phase: 'idle',
    project,
    root,
    settleMs,
    autoFlash: options.autoFlash !== false,
    follow: options.follow !== false,
    guard: options.guard !== false,
    port: monitorPort,
    watching: false,
    watchError: null,
    current: null,
    last: null,
    history: [],
    keil: { windows: [], probes: [], driver: '', flasher: '', checkedAt: 0 },
  }

  const debugInfo = () => {
    try {
      const stat = fs.statSync(project)
      if (projectDebugCache.file !== project || projectDebugCache.mtimeMs !== stat.mtimeMs) {
        const parsed = parseProjectDebug(project)
        projectDebugCache = { file: project, mtimeMs: stat.mtimeMs, ...parsed }
      }
      return { driver: projectDebugCache.driver, flasher: projectDebugCache.flasher }
    } catch {
      return { driver: '', flasher: '' }
    }
  }

  const view = () => ({
    enabled: state.enabled,
    phase: state.phase,
    project: state.project,
    root: state.root,
    settleMs: state.settleMs,
    autoFlash: state.autoFlash,
    follow: state.follow,
    guard: state.guard,
    port: state.port,
    baud: monitorBaud,
    watching: state.watching,
    watchError: state.watchError,
    current: state.current,
    last: state.last,
    history: state.history,
    keil: {
      windows: state.keil.windows,
      probes: state.keil.probes,
      driver: state.keil.driver,
      flasher: state.keil.flasher,
      checkedAt: state.keil.checkedAt,
    },
  })

  const publish = () => {
    try { hub.broadcast({ type: 'loop', loop: view() }) } catch { /* no subscriber */ }
  }

  /** The folder watched for this project: the project root above `MDK-ARM`. */
  const watchRoot = () => path.dirname(path.dirname(project))

  /** Whether a project is configured and still on disk. */
  const ready = () => typeof project === 'string' && project.length > 0 && fs.existsSync(project)

  const setPhase = (phase, current) => {
    state.phase = phase
    state.current = current
    publish()
  }

  const pushHistory = (run) => {
    state.history.unshift({
      at: run.at,
      ok: run.ok,
      pending: run.pending === true,
      buildOk: run.buildOk,
      flashOk: run.flashOk,
      errors: run.errors,
      warnings: run.warnings,
      buildMs: run.buildMs,
      flashMs: run.flashMs,
      reason: run.reason,
      files: run.files.slice(0, 8),
    })
    if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT
  }

  const stopWatch = () => {
    if (debounce !== null) {
      clearTimeout(debounce)
      debounce = null
    }
    if (watcher !== null) {
      try { watcher.close() } catch { /* already closed */ }
      watcher = null
    }
    state.watching = false
  }

  const schedule = (relative) => {
    pendingFiles.add(relative)
    if (debounce !== null) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      void run('auto')
    }, settleMs)
    if (state.phase === 'idle' || state.phase === 'ok' || state.phase === 'built'
      || state.phase === 'build-failed' || state.phase === 'flash-failed' || state.phase === 'mismatch') {
      state.phase = 'settling'
      state.current = { startedAt: Date.now(), files: [...pendingFiles].slice(0, 8), reason: 'auto' }
      publish()
    }
  }

  const startWatch = () => {
    stopWatch()
    if (!state.enabled || !ready()) {
      publish()
      return
    }
    try {
      watcher = fs.watch(watchRoot(), { recursive: true }, (event, filename) => {
        if (filename === null || disposed) return
        const relative = String(filename)
        if (!isSourcePath(relative)) return
        schedule(relative)
      })
      watcher.on('error', (error) => {
        state.watchError = error instanceof Error ? error.message : String(error)
        stopWatch()
        publish()
      })
      state.watching = true
      state.watchError = null
    } catch (error) {
      state.watching = false
      state.watchError = error instanceof Error ? error.message : String(error)
    }
    publish()
  }

  /** Run one UV4 command to completion; its log lands in the temp directory. */
  const runUv4 = (flag, logPath) => new Promise((resolve) => {
    try { fs.rmSync(logPath, { force: true }) } catch { /* nothing to remove */ }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
    }, flag === '-b' ? BUILD_TIMEOUT_MS : FLASH_TIMEOUT_MS)
    let child
    try {
      child = spawn(uv4, [flag, project, '-j0', '-o', logPath], { windowsHide: true, stdio: 'ignore' })
    } catch (error) {
      clearTimeout(timer)
      resolve({ exit: -1, log: '', error: error instanceof Error ? error.message : String(error) })
      return
    }
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ exit: -1, log: '', error: error instanceof Error ? error.message : String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exit: typeof code === 'number' ? code : -1, log: readLog(logPath), error: null })
    })
  })

  /** Read a UV4 log; UV4 writes the machine's ANSI code page, which is GBK here. */
  const readLog = (file) => {
    try {
      return decodeConsole(fs.readFileSync(file))
    } catch {
      return ''
    }
  }

  /** After a download, reopen the port on a fresh handle so a re-enumerated device is read again. */
  const ensureMonitoring = async () => {
    if (monitorPort === undefined || monitorPort === null || monitorPort.length === 0) return
    // A flashed board drops and re-enumerates its USB serial port; the old handle survives but stays silent.
    await new Promise(resolve => setTimeout(resolve, 2000))
    try { hub.stop(monitorPort) } catch { /* nothing was open */ }
    try {
      await hub.start(monitorPort, monitorBaud)
    } catch { /* the port may belong to another program; the round still counts */ }
  }

  /** The Keil project the IDE shows, when it shows exactly one. */
  const openProjects = () => state.keil.windows
    .map(window => window.project)
    .filter(candidate => typeof candidate === 'string' && candidate.length > 0)

  /** Whether a download may run for the configured project right now. */
  const downloadBlocker = () => {
    if (!state.guard) return null
    const open = openProjects()
    if (open.length === 0) return null
    if (open.some(candidate => samePath(candidate, project))) return null
    return `Keil currently has ${open[0]} open, not ${project}; download skipped`
  }

  /** Follow the project the IDE shows, when following is on. */
  const followKeil = () => {
    if (!state.follow) return
    const open = openProjects()
    if (open.length === 0) return
    if (open.some(candidate => samePath(candidate, project))) return
    const target = open[0]
    if (!fs.existsSync(target)) return
    applyProject(target, false)
  }

  /** Move the loop to another project; the caller decided whether history survives. */
  const applyProject = (nextProject, resetHistory) => {
    const resolved = path.resolve(String(nextProject))
    if (!fs.existsSync(resolved)) throw new Error(`project not found: ${resolved}`)
    project = resolved
    state.project = project
    root = path.resolve(path.dirname(project), '..', '..', '..')
    state.root = root
    if (resetHistory) {
      state.last = null
      state.history = []
    }
    state.phase = 'idle'
    state.current = null
    pendingFiles.clear()
    const info = debugInfo()
    state.keil.driver = info.driver
    state.keil.flasher = info.flasher
    startWatch()
    publish()
  }

  /** One download of the current build; used by the automatic round and by the manual button. */
  const download = async (record, reason) => {
    const blocker = downloadBlocker()
    if (blocker !== null) {
      record.ok = false
      record.pending = true
      record.message = blocker
      state.last = record
      pushHistory(record)
      setPhase('mismatch', null)
      return false
    }
    const flashLog = path.join(os.tmpdir(), `dsh-uv4-flash-${String(process.pid)}.log`)
    setPhase('flashing', { startedAt: record.at, files: record.files.slice(0, 8), reason })
    const startedAt = Date.now()
    const flashed = await runUv4('-f', flashLog)
    const flash = parseFlash(flashed.exit, flashed.log)
    record.flashOk = flash.ok
    record.flashTail = flash.tail
    record.flashMs = Date.now() - startedAt
    record.pending = false
    if (!flash.ok) {
      record.ok = false
      record.message = flashed.error ?? `the download exited ${String(flashed.exit)} without confirmation`
      state.last = record
      pushHistory(record)
      setPhase('flash-failed', null)
      return false
    }
    record.ok = true
    record.message = 'built and downloaded'
    state.last = record
    pushHistory(record)
    setPhase('ok', null)
    await ensureMonitoring()
    return true
  }

  /** One build (+ download) round. */
  const run = async (reason) => {
    if (disposed) return
    if (!ready()) {
      const record = {
        at: Date.now(), reason, files: [], ok: false, pending: false, buildOk: false, flashOk: false,
        errors: undefined, warnings: undefined, errorLines: [], buildTail: [], flashTail: [],
        buildMs: 0, flashMs: 0, exit: -1,
        message: 'no Keil project is configured; open one in Keil or set "project" in the plugin config',
      }
      state.last = record
      pushHistory(record)
      setPhase('error', null)
      return
    }
    if (running) {
      queued = true
      return
    }
    running = true
    const startedAt = Date.now()
    const files = [...pendingFiles]
    pendingFiles.clear()
    if (debounce !== null) {
      clearTimeout(debounce)
      debounce = null
    }
    const buildLog = path.join(os.tmpdir(), `dsh-uv4-build-${String(process.pid)}.log`)
    try {
      setPhase('building', { startedAt, files: files.slice(0, 8), reason })
      const built = await runUv4('-b', buildLog)
      const build = parseBuild(built.exit, built.log)
      const record = {
        at: startedAt,
        reason,
        files,
        ok: false,
        pending: false,
        buildOk: build.ok,
        flashOk: false,
        errors: build.errors,
        warnings: build.warnings,
        errorLines: build.errorLines,
        buildTail: build.tail,
        flashTail: [],
        buildMs: Date.now() - startedAt,
        flashMs: 0,
        exit: built.exit,
        message: built.error,
      }
      if (!build.ok) {
        record.message = built.error ?? (build.errors === undefined
          ? 'the build printed no summary line'
          : `${String(build.errors)} build error(s)`)
        state.last = record
        pushHistory(record)
        setPhase('build-failed', null)
        return
      }
      if (!state.autoFlash) {
        record.ok = false
        record.pending = true
        record.message = 'built; download waits for the manual button'
        state.last = record
        pushHistory(record)
        setPhase('built', null)
        return
      }
      await download(record, reason)
    } catch (error) {
      const record = {
        at: startedAt,
        reason,
        files,
        ok: false,
        pending: false,
        buildOk: false,
        flashOk: false,
        errors: undefined,
        warnings: undefined,
        errorLines: [],
        buildTail: [],
        flashTail: [],
        buildMs: Date.now() - startedAt,
        flashMs: 0,
        exit: -1,
        message: error instanceof Error ? error.message : String(error),
      }
      state.last = record
      pushHistory(record)
      setPhase('error', null)
    } finally {
      running = false
      publish()
      if (queued && !disposed) {
        queued = false
        setTimeout(() => { void run('queued') }, 400)
      }
    }
  }

  /** Download the last successful build without rebuilding. */
  const downloadNow = async () => {
    const base = state.last
    if (base === null || base.buildOk !== true) {
      throw new Error('no successful build to download yet')
    }
    const record = { ...base, at: Date.now(), reason: 'manual', pending: false }
    await download(record, 'manual')
    return view()
  }

  /** Poll the Keil IDE windows and refresh the project's debugger description. */
  const pollKeil = async () => {
    if (polling || disposed) return
    polling = true
    try {
      const result = await runProcess('tasklist', ['/v', '/fo', 'csv', '/fi', 'imagename eq UV4.exe'], PROCESS_TIMEOUT_MS)
      // A failed listing says nothing about the IDE; keep the last known windows so the guard stays honest.
      if (result.exit !== 0) return
      const windows = parseKeilWindows(decodeConsole(result.stdout))
      const before = JSON.stringify(state.keil.windows)
      const after = JSON.stringify(windows)
      if (before !== after) {
        state.keil.windows = windows
        state.keil.checkedAt = Date.now()
        const info = debugInfo()
        state.keil.driver = info.driver
        state.keil.flasher = info.flasher
        followKeil()
        publish()
      }
    } catch { /* tasklist is best-effort */ } finally {
      polling = false
    }
  }

  /** Poll the plugged-in debug probes. */
  const pollProbes = async () => {
    if (disposed) return
    try {
      const result = await runProcess('pnputil', ['/enum-devices', '/connected'], PROCESS_TIMEOUT_MS * 2)
      const probes = result.exit === 0 ? parseProbes(decodeConsole(result.stdout)) : []
      if (JSON.stringify(probes) !== JSON.stringify(state.keil.probes)) {
        state.keil.probes = probes
        state.keil.checkedAt = Date.now()
        publish()
      }
    } catch { /* pnputil is best-effort */ }
  }

  /** All Keil projects below the configured root, for the picker. */
  const scanProjects = () => {
    const found = []
    if (typeof root !== 'string' || root.length === 0) return found
    const walk = (dir, depth) => {
      if (depth > 6 || found.length >= 60) return
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (['objects', 'listings', 'rte', '.git', 'dsh-plugins'].includes(entry.name.toLowerCase())) continue
          walk(full, depth + 1)
          continue
        }
        if (entry.name.toLowerCase().endsWith('.uvprojx')) found.push(full)
      }
    }
    walk(root, 0)
    found.sort((left, right) => left.localeCompare(right))
    return found
  }

  return {
    view,
    run,
    downloadNow,
    scanProjects,
    watchRoot,
    /** Turn the automatic round on or off. */
    setEnabled(value) {
      state.enabled = value === true
      if (state.enabled) startWatch()
      else stopWatch()
      publish()
      return view()
    },
    /** Download after a successful build, or wait for the manual button. */
    setAutoFlash(value) {
      state.autoFlash = value === true
      publish()
      return view()
    },
    /** Follow the project the Keil IDE currently shows. */
    setFollow(value) {
      state.follow = value === true
      if (state.follow) followKeil()
      publish()
      return view()
    },
    /** Point the loop at another project and restart its watch; choosing one by hand stops following the IDE. */
    setProject(nextProject) {
      state.follow = false
      applyProject(nextProject, true)
      return view()
    },
    /** Print streams and timers owned by the loop. */
    activate() {
      if (state.enabled) startWatch()
      void pollKeil()
      void pollProbes()
      keilTimer = setInterval(() => { void pollKeil() }, KEIL_POLL_MS)
      probeTimer = setInterval(() => { void pollProbes() }, PROBE_POLL_MS)
      if (typeof keilTimer.unref === 'function') keilTimer.unref()
      if (typeof probeTimer.unref === 'function') probeTimer.unref()
      publish()
    },
    dispose() {
      disposed = true
      stopWatch()
      if (keilTimer !== null) clearInterval(keilTimer)
      if (probeTimer !== null) clearInterval(probeTimer)
      pendingFiles.clear()
    },
  }
}
