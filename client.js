/**
 * Serial monitor — Client half.
 *
 * Registers a left-sidebar panel (port management) and a right-sidebar tab
 * (live log with a port picker). Both render one shared store fed by the
 * Host's SSE route, so the panel, the tab, and the agent's `serial_monitor`
 * tool always show the same lines.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-serial-monitor',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace of every string this plugin shows. */
    const NS = 'serialMonitor'
    /** Left-sidebar panel id; the `main` slot registers the same key. */
    const PANEL_ID = 'serial-monitor'
    /** Tab implementation identity, unique across tab types. */
    const TAB_ID = '@local/dsh-serial-monitor/tab'
    /** Tab kind the guide card and `openTab` name. */
    const TAB_KIND = 'serial-monitor'
    /** Kind an earlier version registered as a second tab; saved layouts may still hold one. */
    const LEGACY_BUILD_KIND = 'serial-build'
    /** Host route prefix owned by the plugin's Host half. */
    const ROUTE = '/plugin-serial-monitor'
    const DEFAULT_BAUD = 115200
    const BAUD_CHOICES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]
    const MAX_LINES = 2000
    /** A stream with no frame for this long is treated as dead and reopened; the Host pings every 20s. */
    const IDLE_TIMEOUT_MS = 45000
    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

    /** English copy. */
    const en = {
      panel: 'Serial monitor',
      tabTitle: 'Serial monitor',
      guideDescription: 'Live serial output with a port picker',
      openInSidebar: 'Open in right sidebar',
      refresh: 'Refresh ports',
      hint: 'Pick a detected port and start monitoring. The agent drives the same monitor with the serial_monitor tool; both sides share one reader, so a port is never opened twice.',
      noPorts: 'No serial ports were detected on this machine.',
      noPortsHint: 'Connect a device and press Refresh ports.',
      start: 'Start',
      stop: 'Stop',
      clear: 'Clear',
      view: 'Open tab',
      baud: 'Baud',
      showPort: 'Displayed port',
      autoScroll: 'Auto-scroll',
      lines: 'lines',
      waiting: 'Waiting for data…',
      waitingHint: 'The port is open; lines appear here as the device writes them.',
      notMonitoring: 'This port is not monitored.',
      notMonitoringHint: 'Press Start to read it; the log appears here and stays after the tab closes.',
      choosePort: 'Choose a port',
      noSelection: 'No port selected',
      connected: 'Host connected',
      connecting: 'Connecting to the host…',
      disconnected: 'Host connection lost, reconnecting…',
      idle: 'Idle',
      starting: 'Opening…',
      open: 'Reading',
      closed: 'Stopped',
      error: 'Error',
      dismiss: 'Dismiss',
      sectionMonitored: 'Being monitored',
      sectionAvailable: 'Available ports',
      summary: '{monitored} monitored · {lines} lines buffered',
      buildSection: 'Build loop',
      buildAuto: 'Build after each save',
      buildAutoFlash: 'Download after a successful build',
      buildFollow: 'Follow the project Keil has open',
      buildNow: 'Build now',
      buildNowAuto: 'Build and download now',
      buildDownload: 'Download',
      buildProject: 'Project',
      noProject: 'No project configured — open one in Keil, or pick one below',
      buildWatchOn: 'Watching saved sources',
      buildWatchOff: 'Not watching',
      buildAfterDownload: 'reads {port} after a download',
      buildDebounce: 'settle {ms} ms',
      buildPhaseIdle: 'Waiting for a save',
      buildPhaseSettling: 'Waiting for the edits to settle…',
      buildPhaseBuilding: 'Building…',
      buildPhaseFlashing: 'Downloading…',
      buildPhaseOk: 'Passed',
      buildPhaseBuilt: 'Built, waiting for download',
      buildPhaseBuildFailed: 'Build errors',
      buildPhaseFlashFailed: 'Download failed',
      buildPhaseMismatch: 'Other project open in Keil',
      buildPhaseError: 'Failed',
      buildKeilNone: 'No Keil project is open',
      buildKeilMatch: 'matches this loop',
      buildKeilMismatch: 'does not match this loop, download blocked',
      buildDebugger: 'debugger {dll}',
      buildFlasher: 'flasher {dll}',
      buildProbe: 'probe {name}',
      buildProbeNone: 'no debug probe detected',
      buildConnectOk: 'last download verified',
      buildConnectFailed: 'last download failed',
      buildConnectUnknown: 'no download yet',
      buildAutoShort: 'Auto download',
      buildRun: 'Build',
      buildOpenTab: 'Settings',
      modeAscii: 'ASCII',
      modeHex: 'HEX',
      send: 'Send',
      sendText: 'Text',
      sendHex: 'HEX',
      sendPlaceholder: 'Type data, Enter sends',
      endingNone: 'No ending',
      endingCr: 'CR',
      endingLf: 'LF',
      endingCrlf: 'CRLF',
      sendNeedsPort: 'Start monitoring a port to send data.',
      sent: 'Sent {n} byte(s).',
      buildErrors: '{n} error(s)',
      buildWarnings: '{n} warning(s)',
      buildBuildTime: 'build {s}s',
      buildFlashTime: 'download {s}s',
      buildShowLog: 'Show log',
      buildHideLog: 'Hide log',
      buildHistory: 'Recent rounds',
      buildNoRuns: 'No build has run yet.',
      buildSwitch: 'Choose project',
      buildFiles: 'changed: {files}',
      refreshFailed: 'Could not read the ports: {message}',
      actionFailed: '{action} failed: {message}',
      stoppedNotice: '{port} stopped.',
    }

    /** Simplified Chinese copy. */
    const zh = {
      panel: '串口监控',
      tabTitle: '串口监控',
      guideDescription: '带端口选择的实时串口日志',
      openInSidebar: '在右侧栏打开',
      refresh: '刷新端口',
      hint: '选择一个检测到的端口并开始监控。Agent 通过 serial_monitor 工具驱动同一个监控；两侧共用同一路读取，端口不会被重复打开。',
      noPorts: '没有检测到串口。',
      noPortsHint: '接上设备后点“刷新端口”。',
      start: '开始',
      stop: '停止',
      clear: '清空',
      view: '打开标签页',
      baud: '波特率',
      showPort: '显示串口',
      autoScroll: '自动滚动',
      lines: '行',
      waiting: '等待数据…',
      waitingHint: '端口已打开，设备写入的数据会实时出现在这里。',
      notMonitoring: '该端口未监控。',
      notMonitoringHint: '按“开始”读取；日志会保留，关闭标签页不会停止监控。',
      choosePort: '选择端口',
      noSelection: '未选择端口',
      connected: '已连接 Host',
      connecting: '正在连接 Host…',
      disconnected: 'Host 连接已断开，正在重连…',
      idle: '空闲',
      starting: '正在打开…',
      open: '读取中',
      closed: '已停止',
      error: '错误',
      dismiss: '关闭',
      sectionMonitored: '监控中',
      sectionAvailable: '可用端口',
      summary: '{monitored} 个端口监控中 · 共 {lines} 行',
      buildSection: '构建闭环',
      buildAuto: '保存后自动编译',
      buildAutoFlash: '编译通过后自动下载',
      buildFollow: '跟随 Keil 打开的工程',
      buildNow: '立即编译',
      buildNowAuto: '立即编译并下载',
      buildDownload: '下载',
      buildProject: '工程',
      noProject: '未配置工程——在 Keil 里打开一个，或从下面选择',
      buildWatchOn: '正在监听源码',
      buildWatchOff: '未监听',
      buildAfterDownload: '下载后读取 {port}',
      buildDebounce: '防抖 {ms} ms',
      buildPhaseIdle: '等待保存',
      buildPhaseSettling: '等待改动稳定…',
      buildPhaseBuilding: '正在编译…',
      buildPhaseFlashing: '正在下载…',
      buildPhaseOk: '通过',
      buildPhaseBuilt: '已编译，待下载',
      buildPhaseBuildFailed: '编译有错误',
      buildPhaseFlashFailed: '下载失败',
      buildPhaseMismatch: 'Keil 打开的是别的工程',
      buildPhaseError: '失败',
      buildKeilNone: '未检测到打开的 Keil 工程',
      buildKeilMatch: '与本闭环一致',
      buildKeilMismatch: '与本闭环不一致，已阻止下载',
      buildDebugger: '调试器 {dll}',
      buildFlasher: '烧录 {dll}',
      buildProbe: '下载器 {name}',
      buildProbeNone: '未检测到下载器',
      buildConnectOk: '最近下载成功',
      buildConnectFailed: '最近下载失败',
      buildConnectUnknown: '还未下载过',
      buildAutoShort: '自动下载',
      buildRun: '编译',
      buildOpenTab: '设置',
      modeAscii: 'ASCII',
      modeHex: 'HEX',
      send: '发送',
      sendText: '文本',
      sendHex: 'HEX',
      sendPlaceholder: '输入要发送的数据，回车发送',
      endingNone: '无结束符',
      endingCr: 'CR',
      endingLf: 'LF',
      endingCrlf: 'CRLF',
      sendNeedsPort: '先开始监控一个端口再发送。',
      sent: '已发送 {n} 字节。',
      buildErrors: '{n} 个错误',
      buildWarnings: '{n} 个警告',
      buildBuildTime: '编译 {s}s',
      buildFlashTime: '下载 {s}s',
      buildShowLog: '显示日志',
      buildHideLog: '收起日志',
      buildHistory: '最近记录',
      buildNoRuns: '还没有编译记录。',
      buildSwitch: '选择工程',
      buildFiles: '改动：{files}',
      refreshFailed: '读取端口失败：{message}',
      actionFailed: '{action} 失败：{message}',
      stoppedNotice: '{port} 已停止。',
    }

    /** The browser fetch, routed through the shell transport when the page has one. */
    function createFetcher() {
      const transport = globalThis.__DSH_TRANSPORT__
      if (transport !== undefined && typeof transport.fetch === 'function') {
        return (input, init) => transport.fetch(input, init)
      }
      return (input, init) => fetch(input, init)
    }

    /** One timestamp as `HH:MM:SS.mmm` in the page's zone. */    function formatTime(at) {
      const date = new Date(at)
      const pad = (value, width) => String(value).padStart(width, '0')
      return `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`
    }

    /** A line's text without the carriage returns a CRLF device leaves behind. */
    function trimmedOf(text) {
      return text.replace(/\r+$/, '')
    }

    /** The shared store behind both surfaces. */
    function createSerialStore(options) {
      const { fetcher, onOpened } = options
      let snapshot = {
        status: 'connecting',
        notice: null,
        ports: [],
        monitors: {},
        selected: null,
        autoScroll: true,
        baudDraft: {},
        loop: null,
        projects: [],
        display: 'ascii',
        sendMode: 'text',
        ending: 'crlf',
      }
      const listeners = new Set()
      const pending = []
      let flushTimer = null

      const publish = (next) => {
        snapshot = next
        for (const listener of [...listeners]) listener()
      }
      const patch = (fields) => { publish({ ...snapshot, ...fields }) }
      const keyOf = (port) => String(port ?? '').toUpperCase()

      const flush = () => {
        flushTimer = null
        if (pending.length === 0) return
        const monitors = { ...snapshot.monitors }
        for (const entry of pending) {
          const monitor = monitors[entry.key] ?? {
            port: entry.port, baud: DEFAULT_BAUD, state: 'open', error: null, lines: [], lastSeq: 0,
          }
          const lines = monitor.lines.concat(entry.line)
          monitors[entry.key] = {
            ...monitor,
            lines: lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines,
            lastSeq: entry.line.seq,
          }
        }
        pending.length = 0
        patch({ monitors })
      }
      const queueLine = (port, line) => {
        pending.push({ key: keyOf(port), port, line })
        if (flushTimer === null) flushTimer = setTimeout(flush, 40)
      }

      /** Every port the UI can offer: detected first, then monitored extras. */
      const available = (state) => {
        const seen = new Set()
        const list = []
        for (const port of state.ports) {
          const key = keyOf(port)
          if (seen.has(key)) continue
          seen.add(key)
          list.push(key)
        }
        for (const key of Object.keys(state.monitors)) {
          if (seen.has(key)) continue
          seen.add(key)
          list.push(key)
        }
        return list
      }

      const nameOf = (state, key) => state.monitors[key]?.port ?? state.ports.find(port => keyOf(port) === key) ?? key

      const pickDefault = (state) => {
        if (state.selected !== null && available(state).includes(state.selected)) return state.selected
        const live = Object.keys(state.monitors).find(key => state.monitors[key].state === 'open'
          || state.monitors[key].state === 'starting')
        if (live !== undefined) return live
        const monitored = Object.keys(state.monitors)[0]
        if (monitored !== undefined) return monitored
        const first = available(state)[0]
        return first ?? null
      }

      /** Merge one monitor view the Host returned from a control request. */
      const absorb = (view) => {
        if (view === null || typeof view !== 'object') return
        const key = keyOf(view.port)
        const previous = snapshot.monitors[key]
        const monitors = {
          ...snapshot.monitors,
          [key]: {
            ...(previous ?? { port: view.port, lines: [], lastSeq: 0 }),
            port: previous?.port ?? view.port,
            baud: view.baud ?? previous?.baud ?? DEFAULT_BAUD,
            state: view.state ?? previous?.state ?? 'idle',
            error: view.error ?? null,
          },
        }
        const next = { ...snapshot, monitors }
        publish({ ...next, selected: pickDefault(next) })
      }

      const apply = (event) => {
        if (event === null || typeof event !== 'object') return
        if (event.type === 'init') {
          const monitors = {}
          for (const view of event.monitors ?? []) {
            monitors[keyOf(view.port)] = {
              port: view.port,
              baud: view.baud,
              state: view.state,
              error: view.error ?? null,
              lines: view.lines ?? [],
              lastSeq: view.seq ?? 0,
            }
          }
          const next = { ...snapshot, ports: event.ports ?? [], monitors, ...(event.loop === undefined ? {} : { loop: event.loop }) }
          publish({ ...next, selected: pickDefault(next) })
          return
        }
        if (event.type === 'loop') {
          if (event.loop !== null && typeof event.loop === 'object') patch({ loop: event.loop })
          return
        }
        if (event.type === 'ports') {
          const next = { ...snapshot, ports: event.ports ?? [] }
          publish({ ...next, selected: pickDefault(next) })
          return
        }
        if (event.type === 'monitor') {
          absorb(event.monitor)
          return
        }
        if (event.type === 'state') {
          const key = keyOf(event.port)
          const previous = snapshot.monitors[key]
          const monitors = {
            ...snapshot.monitors,
            [key]: {
              ...(previous ?? { port: event.port, lines: [], lastSeq: 0 }),
              port: previous?.port ?? event.port,
              baud: event.baud ?? previous?.baud ?? DEFAULT_BAUD,
              state: event.state,
              error: event.error ?? null,
            },
          }
          if (event.state === 'open' && onOpened !== undefined && (previous === undefined || previous.state !== 'open')) onOpened(key)
          const next = { ...snapshot, monitors }
          publish({ ...next, selected: pickDefault(next) })
          return
        }
        if (event.type === 'line') {
          queueLine(event.port, { seq: event.seq, at: event.at, text: event.text, hex: event.hex, dir: event.dir })
          return
        }
        if (event.type === 'cleared') {
          const key = keyOf(event.port)
          const previous = snapshot.monitors[key]
          if (previous === undefined) return
          patch({ monitors: { ...snapshot.monitors, [key]: { ...previous, lines: [] } } })
        }
      }

      /** Read one SSE stream until it ends, the watchdog cancels it, or the caller aborts. */
      const readStream = async (signal, onOpen) => {
        const response = await fetcher(`${ROUTE}/stream`, {
          method: 'GET',
          headers: { accept: 'text/event-stream' },
          signal,
        })
        if (!response.ok || response.body === null) throw new Error(`stream answered ${String(response.status)}`)
        onOpen()
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        let idle = null
        const arm = () => {
          if (idle !== null) clearTimeout(idle)
          // A reply never arrives on a dead connection: cancel the read so the caller reopens it.
          idle = setTimeout(() => { reader.cancel().catch(() => {}) }, IDLE_TIMEOUT_MS)
        }
        arm()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done === true) break
            arm()
            buffer += value
            let index = buffer.indexOf('\n\n')
            while (index >= 0) {
              const frame = buffer.slice(0, index)
              buffer = buffer.slice(index + 2)
              for (const line of frame.split('\n')) {
                if (!line.startsWith('data:')) continue
                const data = line.slice(5).trim()
                if (data.length === 0) continue
                try { apply(JSON.parse(data)) } catch { /* a malformed frame is dropped */ }
              }
              index = buffer.indexOf('\n\n')
            }
          }
        } finally {
          if (idle !== null) clearTimeout(idle)
          reader.cancel().catch(() => {})
        }
      }

      /** Keep the stream connected until the returned disposal aborts it. */
      const connect = () => {
        const controller = new AbortController()
        let timer = null
        let delay = 500
        const run = () => {
          readStream(controller.signal, () => {
            delay = 500
            patch({ status: 'open' })
          }).then(() => {
            if (!controller.signal.aborted) patch({ status: 'closed' })
          }).catch(() => {
            if (!controller.signal.aborted) patch({ status: 'closed' })
          }).finally(() => {
            if (controller.signal.aborted) return
            timer = setTimeout(() => {
              patch({ status: 'connecting' })
              run()
            }, delay)
            delay = Math.min(delay * 2, 10000)
          })
        }
        patch({ status: 'connecting' })
        fetcher(`${ROUTE}/state`, { method: 'GET' }).then(async (response) => {
          if (!response.ok) return
          const value = await response.json()
          apply({ type: 'init', ports: value.ports ?? [], monitors: value.monitors ?? [] })
        }).catch(() => { /* the stream carries the same snapshot */ })
        run()
        return () => {
          controller.abort()
          if (timer !== null) clearTimeout(timer)
          if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null }
        }
      }

      const post = async (path, body) => {
        const response = await fetcher(`${ROUTE}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dsh-serial-monitor': '1' },
          body: JSON.stringify(body),
        })
        const value = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(value.error ?? `HTTP ${String(response.status)}`)
        return value
      }

      const fail = (action, error) => {
        patch({ notice: error instanceof Error ? error.message : String(error), noticeAction: action })
      }

      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        connect,
        available: () => available(snapshot),
        nameOf: (key) => nameOf(snapshot, key),
        isLive: (key) => {
          const state = snapshot.monitors[key]?.state
          return state === 'open' || state === 'starting'
        },
        baudOf(key) {
          const monitor = snapshot.monitors[key]
          return snapshot.baudDraft[key] ?? monitor?.baud ?? DEFAULT_BAUD
        },
        select(key) {
          if (snapshot.selected === key) return
          patch({ selected: key })
        },
        setBaud(key, baud) {
          patch({ baudDraft: { ...snapshot.baudDraft, [key]: baud } })
        },
        setAutoScroll(value) {
          patch({ autoScroll: value })
        },
        /** ASCII text or hex bytes in the log. */
        setDisplay(value) {
          patch({ display: value === 'hex' ? 'hex' : 'ascii' })
        },
        /** Text or hex for the send box. */
        setSendMode(value) {
          patch({ sendMode: value === 'hex' ? 'hex' : 'text' })
        },
        setEnding(value) {
          patch({ ending: ['none', 'cr', 'lf', 'crlf'].includes(value) ? value : 'crlf' })
        },
        /** Write bytes through the Host; resolves with the byte count the Host accepted. */
        async send(key, data) {
          try {
            const value = await post('/send', {
              port: nameOf(snapshot, key),
              data,
              encoding: snapshot.sendMode,
              ending: snapshot.ending,
            })
            if (value.monitor !== undefined) absorb(value.monitor)
            return { bytes: typeof value.bytes === 'number' ? value.bytes : 0 }
          } catch (error) {
            fail('send', error)
            return null
          }
        },
        dismissNotice() {
          patch({ notice: null, noticeAction: null })
        },
        /** Merge one build-loop snapshot the Host returned. */
        applyLoop(value) {
          if (value !== null && typeof value === 'object') patch({ loop: value })
        },
        async setLoopEnabled(enabled) {
          try {
            const value = await post('/loop/enable', { enabled })
            this.applyLoop(value.loop)
          } catch (error) {
            fail('buildLoop', error)
          }
        },
        async setAutoFlash(autoFlash) {
          try {
            const value = await post('/loop/autoflash', { autoFlash })
            this.applyLoop(value.loop)
          } catch (error) {
            fail('buildLoop', error)
          }
        },
        async setFollow(follow) {
          try {
            const value = await post('/loop/follow', { follow })
            this.applyLoop(value.loop)
          } catch (error) {
            fail('buildLoop', error)
          }
        },
        async download() {
          try {
            const value = await post('/loop/download', {})
            this.applyLoop(value.loop)
          } catch (error) {
            fail('download', error)
          }
        },
        async runLoop() {
          try {
            const value = await post('/loop/run', {})
            this.applyLoop(value.loop)
          } catch (error) {
            fail('buildLoop', error)
          }
        },
        async switchProject(project) {
          try {
            const value = await post('/loop/project', { project })
            this.applyLoop(value.loop)
          } catch (error) {
            fail('buildLoop', error)
          }
        },
        async loadProjects() {
          try {
            const response = await fetcher(`${ROUTE}/loop/projects`, { method: 'GET' })
            const value = await response.json()
            if (response.ok) patch({ projects: value.projects ?? [] })
          } catch { /* the picker keeps what it already lists */ }
        },
        async refreshPorts() {
          try {
            const response = await fetcher(`${ROUTE}/ports`, { method: 'GET' })
            const value = await response.json()
            if (!response.ok) throw new Error(value.error ?? `HTTP ${String(response.status)}`)
            const next = { ...snapshot, ports: value.ports ?? [] }
            publish({ ...next, selected: pickDefault(next) })
          } catch (error) {
            fail('refresh', error)
          }
        },
        async start(key) {
          try {
            const value = await post('/start', { port: nameOf(snapshot, key), baud: this.baudOf(key) })
            absorb(value.monitor)
          } catch (error) {
            fail('start', error)
          }
        },
        async stop(key) {
          try {
            const value = await post('/stop', { port: nameOf(snapshot, key) })
            absorb(value.monitor)
          } catch (error) {
            fail('stop', error)
          }
        },
        async clear(key) {
          try {
            const value = await post('/clear', { port: nameOf(snapshot, key) })
            const previous = snapshot.monitors[key]
            if (previous !== undefined) {
              publish({ ...snapshot, monitors: { ...snapshot.monitors, [key]: { ...previous, lines: [] } } })
            }
            absorb(value.monitor)
          } catch (error) {
            fail('clear', error)
          }
        },
        async toggle(key) {
          if (this.isLive(key)) await this.stop(key)
          else await this.start(key)
        },
      }
    }

    /** Subscribe a component to the store without relying on a React version-specific hook. */
    function useStore(store) {
      const [state, setState] = React.useState(store.getSnapshot)
      React.useEffect(() => {
        const update = () => setState(store.getSnapshot())
        const off = store.subscribe(update)
        update()
        return off
      }, [store])
      return state
    }

    /** The plugin's glyph: a serial connector with three contacts. */
    function SerialGlyph(props) {
      const size = typeof props.size === 'number' ? props.size : 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 36 36',
        'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
        h('path', {
          d: 'M6 12h16a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6z',
          fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinejoin: 'round',
        }),
        h('path', { d: 'M25 16h5v4h-5', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinejoin: 'round' }),
        h('path', {
          d: 'M11 16.5v3M15.5 16.5v3M20 16.5v3',
          fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round',
        }),
      )
    }

    const CSS = `
.dshsm-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary)}
.dshsm-header{flex:none;display:flex;align-items:center;gap:10px;padding:16px 24px 13px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshsm-heading{display:flex;flex-direction:column;gap:2px;min-width:0}
.dshsm-title{margin:0;font-size:16px;line-height:22px;font-weight:600;letter-spacing:.1px}
.dshsm-caption{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dshsm-grow{flex:1;min-width:0}
.dshsm-body{flex:1;min-height:0;overflow:auto;padding:16px 24px 40px}
.dshsm-section{margin:18px 0 9px;font-size:11px;line-height:16px;font-weight:600;letter-spacing:.7px;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.dshsm-section:first-child{margin-top:0}
.dshsm-cards{display:flex;flex-direction:column;gap:10px;max-width:820px}
.dshsm-card{display:flex;flex-wrap:wrap;align-items:center;gap:14px;row-gap:10px;padding:13px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);transition:border-color .16s ease,box-shadow .16s ease}
.dshsm-card:hover{border-color:var(--dsw-alias-border-l2)}
.dshsm-card-live{border-color:var(--dsw-alias-state-success-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-success-primary)}
.dshsm-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.dshsm-dot-open{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 22%,transparent)}
.dshsm-dot-starting{background:var(--dsw-alias-state-warn-primary)}
.dshsm-dot-error{background:var(--dsw-alias-state-error-primary)}
.dshsm-port{font-family:${MONO};font-size:14px;line-height:20px;font-weight:600;letter-spacing:.2px}
.dshsm-meta{font-family:${MONO};font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.dshsm-pill{flex:none;font-size:11px;line-height:18px;padding:1px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dshsm-pill-open{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,transparent)}
.dshsm-pill-starting{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,transparent)}
.dshsm-pill-error{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent)}
.dshsm-btn{font:inherit;font-size:12px;line-height:18px;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;transition:background .14s ease,border-color .14s ease,color .14s ease}
.dshsm-btn:hover:not([disabled]){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.dshsm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshsm-btn[disabled]{opacity:.42;cursor:default}
.dshsm-btn-accent{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dshsm-btn-accent:hover:not([disabled]){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);border-color:var(--dsw-alias-brand-primary)}
.dshsm-select{font:inherit;font-size:12px;line-height:18px;padding:4px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);min-width:0}
.dshsm-select:hover{border-color:var(--dsw-alias-border-l2)}
.dshsm-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshsm-notice{display:flex;align-items:center;gap:10px;font-size:12px;line-height:18px;padding:8px 12px;border-radius:10px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dshsm-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:44px 16px;text-align:center;color:var(--dsw-alias-label-secondary)}
.dshsm-empty-title{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dshsm-empty-hint{font-size:12px;line-height:18px;max-width:360px}
.dshsm-log{flex:1;min-height:0;display:flex;flex-direction:column;font-family:${MONO}}
.dshsm-log-head{flex:none;display:flex;gap:12px;padding:7px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:10.5px;line-height:16px;letter-spacing:.7px;text-transform:uppercase;color:var(--dsw-alias-label-secondary);user-select:none}
.dshsm-log-body{flex:1;min-height:0;overflow:auto}
.dshsm-line{display:flex;gap:12px;padding:5px 14px;font-size:12px;line-height:1.62;white-space:pre-wrap;word-break:break-word}
.dshsm-line:nth-child(even){background:var(--dsw-alias-bg-layer-1)}
.dshsm-seq{flex:none;width:46px;text-align:right;color:var(--dsw-alias-state-idle-primary);font-variant-numeric:tabular-nums;user-select:none}
.dshsm-time{flex:none;width:84px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;user-select:none}
.dshsm-text{flex:1;min-width:0}
.dshsm-cols{display:flex;gap:12px;padding:0 14px}
.dshsm-cols-seq{width:46px;flex:none;text-align:right}
.dshsm-cols-time{width:84px;flex:none}
.dshsm-bar{flex:none;display:flex;flex-direction:column;gap:8px;padding:11px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshsm-bar-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.dshsm-label{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dshsm-check{display:flex;align-items:center;gap:5px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none;white-space:nowrap}
.dshsm-check input{accent-color:var(--dsw-alias-brand-primary);margin:0}
.dshsm-conn{flex:none;display:flex;align-items:center;gap:6px;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dshsm-error-line{margin:0 12px;padding:7px 10px;border-radius:8px;font-size:11.5px;line-height:17px;color:var(--dsw-alias-state-error-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);font-family:${MONO}}
.dshsm-strip{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:18px}
.dshsm-strip-line{display:flex;align-items:center;gap:8px;min-width:0}
.dshsm-inline{max-height:60vh;overflow:auto;padding:10px 0 4px;border-top:1px solid var(--dsw-alias-border-l1)}
.dshsm-strip-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.dshsm-logblock{margin:0;padding:9px 12px;max-height:190px;overflow:auto;font-family:${MONO};font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1);white-space:pre-wrap;word-break:break-word}
.dshsm-history{display:flex;flex-direction:column;gap:3px}
.dshsm-history-row{display:flex;gap:12px;font-family:${MONO};font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.dshsm-history-ok{color:var(--dsw-alias-state-success-primary)}
.dshsm-history-fail{color:var(--dsw-alias-state-error-primary)}
.dshsm-mark{flex:none;width:12px;color:var(--dsw-alias-brand-primary)}
.dshsm-cols-mark{width:12px;flex:none}
.dshsm-line-tx .dshsm-text{color:var(--dsw-alias-brand-primary)}
.dshsm-send{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:9px 12px;border-top:1px solid var(--dsw-alias-border-l1)}
.dshsm-input{flex:1;min-width:130px;font-family:${MONO};font-size:12px;line-height:18px;padding:5px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dshsm-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshsm-input::placeholder{color:var(--dsw-alias-state-idle-primary)}
.dshsm-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
.dshsm-seg button{font:inherit;font-size:11.5px;line-height:16px;padding:4px 9px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshsm-seg button[aria-pressed='true']{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dshsm-send-status{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
`

    /** Status text for one monitor state. */
    function stateLabel(t, state) {
      return t({ idle: 'idle', starting: 'starting', open: 'open', closed: 'closed', error: 'error' }[state] ?? 'idle')
    }

    /** State pill. */
    function StatePill({ t, state }) {
      return h('span', { className: `dshsm-pill dshsm-pill-${state}` }, stateLabel(t, state))
    }

    /** State dot. */
    function StateDot({ state }) {
      return h('span', { className: `dshsm-dot dshsm-dot-${state}`, 'aria-hidden': true })
    }

    /** Baud selector; both surfaces edit the same draft value. */
    function BaudSelect({ store, t, portKey, disabled, grow }) {
      const value = store.baudOf(portKey)
      const choices = BAUD_CHOICES.includes(value) ? BAUD_CHOICES : [...BAUD_CHOICES, value]
      return h('select', {
        className: 'dshsm-select',
        style: grow === true ? { flex: 1 } : { width: '104px' },
        value: String(value),
        disabled: disabled === true,
        'aria-label': t('baud'),
        onChange: (event) => store.setBaud(portKey, Number(event.target.value)),
      }, choices.map(choice => h('option', { key: String(choice), value: String(choice) }, String(choice))))
    }

    /** Locale keys of the build-loop phases. */
    const PHASE_KEYS = {
      idle: 'buildPhaseIdle',
      settling: 'buildPhaseSettling',
      building: 'buildPhaseBuilding',
      flashing: 'buildPhaseFlashing',
      ok: 'buildPhaseOk',
      built: 'buildPhaseBuilt',
      'build-failed': 'buildPhaseBuildFailed',
      'flash-failed': 'buildPhaseFlashFailed',
      mismatch: 'buildPhaseMismatch',
      error: 'buildPhaseError',
    }

    /** The color role of one phase. */
    function phaseTone(phase) {
      if (phase === 'ok') return 'open'
      if (phase === 'build-failed' || phase === 'flash-failed' || phase === 'error' || phase === 'mismatch') return 'error'
      if (phase === 'settling' || phase === 'building' || phase === 'flashing' || phase === 'built') return 'starting'
      return 'idle'
    }

    /** Localized phase text. */
    function phaseLabel(t, phase) {
      return t(PHASE_KEYS[phase] ?? 'buildPhaseIdle')
    }

    /** `build 2.7s · download 7.1s` for one round. */
    function buildTimes(t, round) {
      if (round === null || round === undefined) return ''
      const parts = [t('buildBuildTime', { s: ((round.buildMs ?? 0) / 1000).toFixed(1) })]
      if ((round.flashMs ?? 0) > 0) parts.push(t('buildFlashTime', { s: (round.flashMs / 1000).toFixed(1) }))
      return parts.join(' · ')
    }

    /** The log lines worth showing for one round: compiler errors first, then the log tail. */
    function runLogLines(round) {
      if (round === null || round === undefined) return []
      const lines = []
      for (const line of round.errorLines ?? []) lines.push(line)
      const tail = round.buildOk === true ? (round.flashTail ?? []) : (round.buildTail ?? [])
      for (const line of tail) if (!lines.includes(line)) lines.push(line)
      return lines.slice(-24)
    }

    /** The build-loop block on the management page. */
    function BuildSection({ store, t }) {
      const snapshot = useStore(store)
      const loop = snapshot.loop
      const [open, setOpen] = React.useState(false)
      React.useEffect(() => { void store.loadProjects() }, [store])
      if (loop === null) return null
      const last = loop.last
      const failed = loop.phase === 'build-failed' || loop.phase === 'flash-failed' || loop.phase === 'error' || loop.phase === 'mismatch'
      const busy = loop.phase === 'settling' || loop.phase === 'building' || loop.phase === 'flashing'
      const lines = runLogLines(last)
      const known = snapshot.projects.filter(project => typeof project === 'string' && project.length > 0)
      const projects = loop.project !== '' && !known.includes(loop.project) ? [loop.project, ...known] : known
      const keil = loop.keil ?? { windows: [], probes: [], driver: '', flasher: '' }
      const openProjects = (keil.windows ?? []).map(window => window.project).filter(project => typeof project === 'string')
      const openNames = openProjects.map(project => String(project).split(/[\\/]/).pop())
      const matched = openProjects.some(project => String(project).toLowerCase() === loop.project.toLowerCase())
      const canDownload = last !== null && last.buildOk === true && !busy
      const connectState = last === null
        ? 'unknown'
        : last.flashOk === true
          ? 'ok'
          : last.pending === true || last.buildOk !== true ? 'unknown' : 'failed'
      return h('div', null,
        h('div', { className: 'dshsm-section' }, t('buildSection')),
        h('div', { className: 'dshsm-card', style: { flexDirection: 'column', alignItems: 'stretch', gap: '10px' } },
          h('div', { className: 'dshsm-bar-row' },
            h('span', { className: 'dshsm-label' }, t('buildProject')),
            h('select', {
              className: 'dshsm-select',
              style: { flex: 1, minWidth: '240px', maxWidth: '560px' },
              value: loop.project,
              'aria-label': t('buildProject'),
              onChange: (event) => { void store.switchProject(event.target.value) },
            }, projects.length === 0
              ? h('option', { value: '' }, t('noProject'))
              : projects.map(project => h('option', { key: project, value: project }, project))),
            h('span', { className: `dshsm-pill${phaseTone(loop.phase) === 'open' ? ' dshsm-pill-open' : phaseTone(loop.phase) === 'error' ? ' dshsm-pill-error' : phaseTone(loop.phase) === 'starting' ? ' dshsm-pill-starting' : ''}` }, phaseLabel(t, loop.phase)),
            h('span', { className: 'dshsm-grow' }),
            h('button', {
              className: 'dshsm-btn dshsm-btn-accent', type: 'button', disabled: busy || loop.project === '',
              onClick: () => { void store.runLoop() },
            }, loop.autoFlash === true ? t('buildNowAuto') : t('buildNow')),
          ),
          h('div', { className: 'dshsm-bar-row' },
            h('label', { className: 'dshsm-check' },
              h('input', {
                type: 'checkbox', checked: loop.enabled,
                onChange: (event) => { void store.setLoopEnabled(event.target.checked) },
              }),
              t('buildAuto'),
            ),
            h('label', { className: 'dshsm-check' },
              h('input', {
                type: 'checkbox', checked: loop.autoFlash,
                onChange: (event) => { void store.setAutoFlash(event.target.checked) },
              }),
              t('buildAutoFlash'),
            ),
            h('label', { className: 'dshsm-check' },
              h('input', {
                type: 'checkbox', checked: loop.follow,
                onChange: (event) => { void store.setFollow(event.target.checked) },
              }),
              t('buildFollow'),
            ),
            h('span', { className: 'dshsm-grow' }),
            h('button', {
              className: 'dshsm-btn', type: 'button', disabled: !canDownload,
              onClick: () => { void store.download() },
            }, t('buildDownload')),
            lines.length === 0 ? null : h('button', {
              className: 'dshsm-btn', type: 'button',
              onClick: () => setOpen(!open),
            }, open ? t('buildHideLog') : t('buildShowLog')),
          ),
          h('div', { className: 'dshsm-bar-row' },
            h('span', { className: 'dshsm-caption' }, loop.watching ? t('buildWatchOn') : t('buildWatchOff')),
            h('span', { className: 'dshsm-caption' }, t('buildDebounce', { ms: loop.settleMs })),
            loop.port === '' ? null : h('span', { className: 'dshsm-caption' }, t('buildAfterDownload', { port: loop.port })),
          ),
          h('div', { className: 'dshsm-bar-row' },
            h(StateDot, { state: openProjects.length === 0 ? 'idle' : matched ? 'open' : 'error' }),
            h('span', {
              className: 'dshsm-meta',
              style: openProjects.length > 0 && !matched ? { color: 'var(--dsw-alias-state-error-primary)' } : undefined,
            }, `Keil: ${openProjects.length === 0 ? t('buildKeilNone') : `${openNames.join(', ')} · ${matched ? t('buildKeilMatch') : t('buildKeilMismatch')}`}`),
          ),
          h('div', { className: 'dshsm-bar-row' },
            keil.driver === '' ? null : h('span', { className: 'dshsm-meta' }, t('buildDebugger', { dll: keil.driver })),
            keil.flasher === '' ? null : h('span', { className: 'dshsm-meta' }, t('buildFlasher', { dll: keil.flasher })),
            h('span', { className: 'dshsm-meta' }, (keil.probes ?? []).length === 0 ? t('buildProbeNone') : t('buildProbe', { name: keil.probes.join(', ') })),
            h('span', {
              className: 'dshsm-meta',
              style: connectState === 'failed'
                ? { color: 'var(--dsw-alias-state-error-primary)' }
                : connectState === 'ok' ? { color: 'var(--dsw-alias-state-success-primary)' } : undefined,
            }, connectState === 'ok' ? t('buildConnectOk') : connectState === 'failed' ? t('buildConnectFailed') : t('buildConnectUnknown')),
          ),
          last === null ? h('span', { className: 'dshsm-caption' }, t('buildNoRuns')) : h('div', { className: 'dshsm-bar-row' },
            h('span', { className: 'dshsm-meta' }, `${new Date(last.at).toLocaleTimeString()} · ${buildTimes(t, last)}`),
            last.errors === undefined ? null : h('span', { className: 'dshsm-meta' }, `${t('buildErrors', { n: last.errors })} · ${t('buildWarnings', { n: last.warnings ?? 0 })}`),
            (last.files ?? []).length === 0 ? null : h('span', { className: 'dshsm-meta', style: { maxWidth: '420px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              t('buildFiles', { files: (last.files ?? []).slice(0, 3).join(', ') })),
          ),
          (open || failed) && lines.length > 0 ? h('pre', { className: 'dshsm-logblock' }, lines.join('\n')) : null,
          loop.watchError === null || loop.watchError === undefined ? null : h('span', { className: 'dshsm-meta', style: { color: 'var(--dsw-alias-state-error-primary)' } }, loop.watchError),
        ),
        loop.history.length === 0 ? null : h('div', null,
          h('div', { className: 'dshsm-section', style: { margin: '14px 0 7px' } }, t('buildHistory')),
          h('div', { className: 'dshsm-history' }, loop.history.slice(0, 6).map(entry => h('div', { className: 'dshsm-history-row', key: String(entry.at) },
            h('span', null, new Date(entry.at).toLocaleTimeString()),
            h('span', { className: entry.ok === true ? 'dshsm-history-ok' : entry.pending === true ? '' : 'dshsm-history-fail' },
              entry.ok === true ? phaseLabel(t, 'ok')
                : entry.pending === true ? phaseLabel(t, 'built')
                  : entry.buildOk === true ? phaseLabel(t, 'flash-failed') : phaseLabel(t, 'build-failed')),
            h('span', null, entry.errors === undefined ? '' : `${String(entry.errors)}E/${String(entry.warnings ?? 0)}W`),
            h('span', null, buildTimes(t, entry)),
          ))),
        ),
      )
    }

    /** The compact build status and controls above the live log. */
    function BuildStrip({ store, t }) {
      const snapshot = useStore(store)
      const loop = snapshot.loop
      const [open, setOpen] = React.useState(false)
      const [settingsOpen, setSettingsOpen] = React.useState(false)
      if (loop === null) return null
      const last = loop.last
      const lines = runLogLines(last)
      const tone = phaseTone(loop.phase)
      const busy = loop.phase === 'settling' || loop.phase === 'building' || loop.phase === 'flashing'
      const canDownload = last !== null && last.buildOk === true && !busy
      const text = last === null
        ? phaseLabel(t, loop.phase)
        : `${phaseLabel(t, loop.phase)} · ${new Date(last.at).toLocaleTimeString()} · ${buildTimes(t, last)}`
      return h(React.Fragment, null,
        h('div', { className: 'dshsm-strip' },
          h('div', { className: 'dshsm-strip-line' },
            h(StateDot, { state: tone }),
            h('span', { className: 'dshsm-strip-text' }, text),
            h('span', { className: 'dshsm-grow' }),
            lines.length === 0 ? null : h('button', {
              className: 'dshsm-btn', type: 'button',
              onClick: () => setOpen(!open),
            }, open ? t('buildHideLog') : t('buildShowLog')),
          ),
          h('div', { className: 'dshsm-strip-line' },
            h('label', { className: 'dshsm-check' },
              h('input', {
                type: 'checkbox', checked: loop.autoFlash,
                onChange: (event) => { void store.setAutoFlash(event.target.checked) },
              }),
              t('buildAutoShort'),
            ),
            h('button', {
              className: 'dshsm-btn', type: 'button', disabled: busy,
              onClick: () => { void store.runLoop() },
            }, t('buildRun')),
            h('button', {
              className: 'dshsm-btn', type: 'button', disabled: !canDownload,
              onClick: () => { void store.download() },
            }, t('buildDownload')),
            h('span', { className: 'dshsm-grow' }),
            h('button', {
              className: 'dshsm-btn', type: 'button',
              'aria-expanded': settingsOpen,
              onClick: () => setSettingsOpen(!settingsOpen),
            }, t('buildOpenTab')),
          ),
          settingsOpen ? h('div', { className: 'dshsm-inline' }, h(BuildSection, { store, t })) : null,
        ),
        open && lines.length > 0 ? h('pre', { className: 'dshsm-logblock' }, lines.join('\n')) : null,
      )
    }

    /** One port card on the management page. */
    function PortCard({ store, t, portKey }) {
      const snapshot = useStore(store)
      const monitor = snapshot.monitors[portKey]
      const state = monitor?.state ?? 'idle'
      const live = state === 'starting' || state === 'open'
      const lines = monitor?.lines.length ?? 0
      const [busy, setBusy] = React.useState(false)
      const run = (action) => {
        setBusy(true)
        action().finally(() => setBusy(false))
      }
      return h('div', { className: `dshsm-card${live ? ' dshsm-card-live' : ''}` },
        h(StateDot, { state }),
        h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
          h('span', { className: 'dshsm-port' }, store.nameOf(portKey)),
          h('span', { className: 'dshsm-meta' },
            `${String(store.baudOf(portKey))} baud · ${String(lines)} ${t('lines')}${monitor?.error === null || monitor?.error === undefined ? '' : ` · ${monitor.error}`}`),
        ),
        h('span', { className: 'dshsm-grow' }),
        h(StatePill, { t, state }),
        h(BaudSelect, { store, t, portKey, disabled: live }),
        live
          ? h('button', {
            className: 'dshsm-btn', type: 'button', disabled: busy,
            onClick: () => { run(() => store.stop(portKey)) },
          }, t('stop'))
          : h('button', {
            className: 'dshsm-btn dshsm-btn-accent', type: 'button', disabled: busy,
            onClick: () => { run(() => store.start(portKey)) },
          }, t('start')),
        h('button', {
          className: 'dshsm-btn', type: 'button',
          onClick: () => { store.select(portKey); store.openRight(portKey) },
        }, t('view')),
      )
    }

    /** The left-sidebar panel page: detect, start, and stop ports. */
    function SerialPage(props) {
      const { store, t } = props
      const snapshot = useStore(store)
      const ports = store.available()
      const monitored = ports.filter(key => {
        const state = snapshot.monitors[key]?.state
        return state === 'starting' || state === 'open' || state === 'error' || state === 'closed'
      })
      const rest = ports.filter(key => !monitored.includes(key))
      const lineTotal = Object.values(snapshot.monitors).reduce((sum, monitor) => sum + monitor.lines.length, 0)
      const connection = snapshot.status === 'open' ? 'open' : snapshot.status === 'closed' ? 'closed' : 'connecting'
      return h('div', { className: 'dshsm-root' },
        h('style', null, CSS),
        h('header', { className: 'dshsm-header' },
          h('span', { style: { display: 'flex', color: 'var(--dsw-alias-label-primary)' } }, h(SerialGlyph, { size: 20 })),
          h('div', { className: 'dshsm-heading' },
            h('h1', { className: 'dshsm-title' }, t('panel')),
            h('span', { className: 'dshsm-caption' }, t('summary', {
              monitored: monitored.filter(key => ['open', 'starting'].includes(snapshot.monitors[key]?.state)).length,
              lines: lineTotal,
            })),
          ),
          h('span', { className: 'dshsm-grow' }),
          h('span', { className: 'dshsm-conn' },
            h(StateDot, { state: connection === 'open' ? 'open' : connection === 'closed' ? 'error' : 'starting' }),
            connection === 'open' ? t('connected') : connection === 'closed' ? t('disconnected') : t('connecting'),
          ),
          h('button', { className: 'dshsm-btn', type: 'button', onClick: () => { void store.refreshPorts() } }, t('refresh')),
          h('button', {
            className: 'dshsm-btn dshsm-btn-accent', type: 'button',
            onClick: () => { store.openRight(snapshot.selected) },
          }, t('openInSidebar')),
        ),
        snapshot.notice === null ? null : h('div', { style: { padding: '12px 24px 0', flex: 'none' } },
          h('div', { className: 'dshsm-notice' },
            h('span', null, t('actionFailed', { action: snapshot.noticeAction ?? '', message: snapshot.notice })),
            h('span', { className: 'dshsm-grow' }),
            h('button', { className: 'dshsm-btn', type: 'button', onClick: () => store.dismissNotice() }, t('dismiss')),
          ),
        ),
        h('div', { className: 'dshsm-body' },
          h(BuildSection, { store, t }),
          h('p', { className: 'dshsm-caption', style: { margin: '18px 0 4px', maxWidth: '820px', lineHeight: '19px' } }, t('hint')),
          ports.length === 0
            ? h('div', { className: 'dshsm-empty' },
              h(SerialGlyph, { size: 28 }),
              h('span', { className: 'dshsm-empty-title' }, t('noPorts')),
              h('span', { className: 'dshsm-empty-hint' }, t('noPortsHint')),
            )
            : [
              monitored.length === 0 ? null : h('div', { key: 'monitored' },
                h('div', { className: 'dshsm-section' }, t('sectionMonitored')),
                h('div', { className: 'dshsm-cards' }, monitored.map(portKey => h(PortCard, { key: portKey, store, t, portKey }))),
              ),
              rest.length === 0 ? null : h('div', { key: 'available' },
                h('div', { className: 'dshsm-section' }, t('sectionAvailable')),
                h('div', { className: 'dshsm-cards' }, rest.map(portKey => h(PortCard, { key: portKey, store, t, portKey }))),
              ),
            ],
        ),
      )
    }

    /** The right-sidebar tab: the live log of the chosen port. */
    function SerialTab(props) {
      const { store, t } = props
      const snapshot = useStore(store)
      const selected = snapshot.selected
      const ports = store.available()
      const monitor = selected === null ? undefined : snapshot.monitors[selected]
      const lines = monitor?.lines ?? []
      const state = monitor?.state ?? 'idle'
      const live = state === 'open' || state === 'starting'
      const logRef = React.useRef(null)
      const connection = snapshot.status === 'open' ? 'open' : snapshot.status === 'closed' ? 'closed' : 'connecting'
      const display = snapshot.display === 'hex' ? 'hex' : 'ascii'
      const canSend = selected !== null && state === 'open'
      const [draft, setDraft] = React.useState('')
      const [sendStatus, setSendStatus] = React.useState(null)
      const sendNow = () => {
        if (!canSend || draft.length === 0) return
        const data = draft
        setDraft('')
        void store.send(selected, data).then((result) => {
          setSendStatus(result === null ? null : t('sent', { n: result.bytes }))
        })
      }

      React.useLayoutEffect(() => {
        const element = logRef.current
        if (element === null || snapshot.autoScroll !== true) return
        element.scrollTop = element.scrollHeight
      }, [lines.length, snapshot.autoScroll, selected])

      const empty = lines.length === 0
        ? h('div', { className: 'dshsm-empty' },
          h(SerialGlyph, { size: 26 }),
          h('span', { className: 'dshsm-empty-title' },
            ports.length === 0 ? t('noPorts')
              : selected === null ? t('noSelection')
                : live ? t('waiting') : t('notMonitoring')),
          h('span', { className: 'dshsm-empty-hint' },
            ports.length === 0 ? t('noPortsHint')
              : selected === null ? t('notMonitoringHint')
                : live ? t('waitingHint') : t('notMonitoringHint')),
        )
        : h('div', { className: 'dshsm-log-body', ref: logRef },
          lines.map(line => h('div', { className: `dshsm-line${line.dir === 'tx' ? ' dshsm-line-tx' : ''}`, key: String(line.seq) },
            h('span', { className: 'dshsm-seq' }, String(line.seq)),
            h('span', { className: 'dshsm-time' }, formatTime(line.at)),
            h('span', { className: 'dshsm-mark' }, line.dir === 'tx' ? '→' : ''),
            h('span', { className: 'dshsm-text' },
              display === 'hex'
                ? (line.hex ?? '')
                : (trimmedOf(line.text).length === 0 ? ' ' : trimmedOf(line.text))),
          )),
        )

      return h('div', { className: 'dshsm-root' },
        h('style', null, CSS),
        h('div', { className: 'dshsm-bar' },
          h('div', { className: 'dshsm-bar-row' },
            h('span', { className: 'dshsm-label' }, t('showPort')),
            h('select', {
              className: 'dshsm-select',
              style: { flex: 1 },
              value: selected ?? '',
              'aria-label': t('showPort'),
              onChange: (event) => { store.select(event.target.value) },
            },
              ports.length === 0
                ? h('option', { value: '' }, t('noSelection'))
                : ports.map(portKey => h('option', { key: portKey, value: portKey }, store.nameOf(portKey))),
            ),
            h(StatePill, { t, state }),
          ),
          h('div', { className: 'dshsm-bar-row' },
            selected === null ? null : h(BaudSelect, { store, t, portKey: selected, disabled: live }),
            h('button', {
              className: live ? 'dshsm-btn' : 'dshsm-btn dshsm-btn-accent',
              type: 'button',
              disabled: selected === null,
              onClick: () => { if (selected !== null) void store.toggle(selected) },
            }, live ? t('stop') : t('start')),
            h('button', {
              className: 'dshsm-btn', type: 'button', disabled: selected === null || lines.length === 0,
              onClick: () => { if (selected !== null) void store.clear(selected) },
            }, t('clear')),
            h('label', { className: 'dshsm-check' },
              h('input', {
                type: 'checkbox', checked: snapshot.autoScroll,
                onChange: (event) => store.setAutoScroll(event.target.checked),
              }),
              t('autoScroll'),
            ),
            h('span', { className: 'dshsm-seg', role: 'group', 'aria-label': t('modeAscii') },
              h('button', { type: 'button', 'aria-pressed': display === 'ascii', onClick: () => store.setDisplay('ascii') }, t('modeAscii')),
              h('button', { type: 'button', 'aria-pressed': display === 'hex', onClick: () => store.setDisplay('hex') }, t('modeHex')),
            ),
            h('span', { className: 'dshsm-grow' }),
            h('span', { className: 'dshsm-conn' },
              h(StateDot, { state: connection === 'open' ? 'open' : connection === 'closed' ? 'error' : 'starting' }),
              connection === 'open' ? null : connection === 'closed' ? t('disconnected') : t('connecting'),
            ),
          ),
          snapshot.notice === null ? null : h('div', { className: 'dshsm-notice' },
            h('span', { className: 'dshsm-grow' }, snapshot.notice),
            h('button', { className: 'dshsm-btn', type: 'button', onClick: () => store.dismissNotice() }, t('dismiss')),
          ),
        ),
        h(BuildStrip, { store, t }),
        monitor?.error === null || monitor?.error === undefined
          ? null
          : h('p', { className: 'dshsm-error-line', style: { marginTop: '10px' } }, monitor.error),
        h('div', { className: 'dshsm-log' },
          h('div', { className: 'dshsm-log-head' },
            h('span', { className: 'dshsm-cols-seq' }, '#'),
            h('span', { className: 'dshsm-cols-time' }, 'time'),
            h('span', { className: 'dshsm-cols-mark' }, ''),
            h('span', { className: 'dshsm-grow' }, display === 'hex' ? 'hex' : 'data'),
          ),
          empty,
        ),
        h('div', { className: 'dshsm-send' },
          h('input', {
            className: 'dshsm-input',
            value: draft,
            placeholder: canSend ? t('sendPlaceholder') : t('sendNeedsPort'),
            disabled: !canSend,
            'aria-label': t('send'),
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                sendNow()
              }
            },
          }),
          h('span', { className: 'dshsm-seg', role: 'group', 'aria-label': t('sendText') },
            h('button', { type: 'button', 'aria-pressed': snapshot.sendMode === 'text', onClick: () => store.setSendMode('text') }, t('sendText')),
            h('button', { type: 'button', 'aria-pressed': snapshot.sendMode === 'hex', onClick: () => store.setSendMode('hex') }, t('sendHex')),
          ),
          h('select', {
            className: 'dshsm-select',
            style: { width: 'auto' },
            value: snapshot.ending,
            'aria-label': t('endingCrlf'),
            onChange: (event) => store.setEnding(event.target.value),
          }, [['none', 'endingNone'], ['cr', 'endingCr'], ['lf', 'endingLf'], ['crlf', 'endingCrlf']]
            .map(entry => h('option', { key: entry[0], value: entry[0] }, t(entry[1])))),
          h('button', {
            className: 'dshsm-btn dshsm-btn-accent', type: 'button', disabled: !canSend || draft.length === 0,
            onClick: sendNow,
          }, t('send')),
          sendStatus === null ? null : h('span', { className: 'dshsm-send-status' }, sendStatus),
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'layout', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'serial-monitor: copy')

        /** Open one of this plugin's right-sidebar tabs, switching back to the conversation when a global panel is shown. */
        const openTab = (kind) => {
          try {
            if (ctx.sidebarRight.mounted.getSnapshot() === undefined) {
              if (ctx.layout.panelInfo.getSnapshot().activePanelId !== 'conversation') return
              ctx.layout.selectPanel('conversation')
            }
            ctx.sidebarRight.openTab(kind)
          } catch { /* the column has no session surface yet; the guide card still opens it */ }
        }

        /** Open the live serial tab for one port. */
        const openRight = (portKey) => {
          if (typeof portKey === 'string' && portKey.length > 0) store.select(portKey)
          openTab(TAB_KIND)
        }

        const store = createSerialStore({
          fetcher: createFetcher(),
          onOpened: () => {
            if (ctx.layout.panelInfo.getSnapshot().activePanelId === 'conversation') openRight()
          },
        })
        store.openRight = openRight
        ctx.effect(() => store.connect(), 'serial-monitor: stream')

        /** Close the build tab an earlier version could have saved into a layout. */
        ctx.effect(() => {
          const right = ctx.sidebarRight
          if (typeof right.tabsIn !== 'function' || typeof right.close !== 'function') return
          if (right.mounted === undefined || typeof right.mounted.subscribe !== 'function') return
          const drop = () => {
            const sessionId = right.mounted.getSnapshot()
            if (sessionId === undefined) return
            for (const tab of right.tabsIn(sessionId)) {
              if (tab.kind !== LEGACY_BUILD_KIND) continue
              try { right.close(tab.id) } catch { /* the tab is already gone */ }
            }
          }
          drop()
          return right.mounted.subscribe(drop)
        }, 'serial-monitor: drop legacy build tab')

        /** Props every surface receives: the store, the translator, and the column opener. */
        const surface = () => ({ store, t, openRight })

        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => t('panel'),
          locale: NS,
        }, SerialGlyph)), 'serial-monitor: panel icon')

        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: surface,
        }, SerialPage)), 'serial-monitor: panel page')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          keepMounted: true,
          title: () => t('tabTitle'),
          guide: [{
            id: 'serial-monitor',
            order: 30,
            title: () => t('tabTitle'),
            description: () => t('guideDescription'),
            icon: SerialGlyph,
          }],
        }), 'serial-monitor: tab type')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: NS,
          inject: surface,
        }, SerialTab)), 'serial-monitor: tab body')
      },
    }
  },
})
