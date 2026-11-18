# Serial monitor

Read serial-port output on this machine, watch it live in the right sidebar, and
keep a Keil build loop running next to it: edit, build, download, watch the boot
log.

The plugin owns **one** reader per port. The left sidebar page, the right sidebar
tab, the agent's `serial_monitor` tool, and the build loop's post-download read
all use the same buffer, so a port is never opened twice.

## Where it shows up

- **Left sidebar entry `Serial monitor`** — the build loop (project, automatic
  rounds, manual round, last result and history) and the port roster: detect,
  set a baud rate, start/stop, open the live tab.
- **Right sidebar tab `Serial monitor`** — one tab for the whole plugin. A status
  strip reports the last build round and carries the everyday build controls
  (auto download, Build, Download); **Settings** unfolds the full build block
  (project picker, automatic rounds, follow switch, Keil / debugger / probe /
  connection rows, build log, round history) inside the same tab. Below it:
  `Displayed port` switches between monitored ports; the toolbar starts, stops,
  clears, and toggles auto-scroll; **ASCII / HEX** switches how received bytes are
  shown; and the box under the log writes back to the port (text or hex, with an
  optional CR/LF/CRLF ending). The tab also appears in the right sidebar's guide.
- **Agent tools** — `serial_monitor` (`ports`, `start`, `stop`, `read`, `clear`,
  `send`) and `build_flash` (`status`, `run`, `download`, `enable`, `disable`,
  `autoflash`, `follow`, `projects`, `project`). Starting a port while the
  conversation is on screen opens the right sidebar tab automatically.

## Serial assistant

Bytes arrive as base64 and are split into lines on the Host, which keeps each
line's text and hex form, so switching ASCII/HEX never re-reads the port.
Writes travel the other way through the same reader process: the panel or the
`send` tool posts bytes, the Host forwards them to the reader, and the reader
writes them to the port; the written bytes are echoed into the log with a `→`
marker, so one transcript holds both directions.

The send box accepts text or hex (`01 02 FF` with spaces is fine, an odd digit
count is rejected) and appends no ending, CR, LF, or CRLF. A single write is
limited to 4096 bytes.

## The build loop

A round is triggered by saved source changes in the project (debounced, default
1500 ms) or by the **Build now** button:

1. `UV4 -b <project> -j0 -o <log>` — the round is judged by the build log alone:
   the last line must report `0 Error(s)` and the process must exit 0. Any error
   stops the round; the compiler error lines are shown in the panel.
2. `UV4 -f <project> -j0 -o <log>` — flash download, confirmed by
   `Flash Load finished` in its log. With **Download after a successful build**
   off the round stops after the build and waits for the **Download** button.
3. The configured serial port is monitored after a successful download, so the
   firmware's boot output continues in the sidebar.

Watched sources are `.c`, `.h`, `.s`, `.cpp`, `.hpp`, `.cxx`, `.sct`, and
`.uvprojx`; `Objects`, `Listings`, `RTE`, `.git`, and node_modules are ignored.

### Which project, which debugger

The loop reads the Keil IDE itself rather than trusting one configured path:

- `tasklist /v` window titles name the `.uvprojx` the IDE has open, so the panel
  shows **Keil: <project> · matches this loop / does not match**.
- With **Follow the project Keil has open** on (the default), switching projects
  in the IDE moves the loop to that project, and choosing a project by hand turns
  following off.
- With the guard on, a download whose project is not the one the IDE shows is
  refused and reported instead of flashed, so a stale configuration cannot write
  the wrong firmware.
- The project file supplies the configured debugger and flash algorithm
  (`<TargetDllName>`, `<Flash2>`); `pnputil` lists a plugged-in probe
  (ST-Link, CMSIS-DAP, J-Link, ULINK), and the last download's log decides
  **last download verified / failed / no download yet**. Keil exposes no
  connect-without-writing command, so the download attempt is the connection
  test.

## Install

The package is a DSH bundle. Install it from a checkout of this repository:

- **Plugins → Add plugin**, pick this directory, or
- `plugin_manager` with `action: install_bundle` and the directory as `target`.

The plugin is Windows-only: the serial reader runs PowerShell's
`System.IO.Ports`, and the build loop drives the Keil command-line executable.

## Configuration

The bundle patch accepts optional settings, set on the plugin's row in the
profile patch (a matching row replaces the whole `config`):

```yaml
- id: serial-monitor
  name: "dsh-serial-keil"
  config:
    project: 'C:\work\demo\MDK-ARM\demo.uvprojx'
    uv4: 'C:\Keil_v5\UV4\UV4.exe'
    port: COM3
    baud: 115200
```

| Field | Default | Meaning |
|---|---|---|
| `project` | *(empty)* | Project a round builds. Empty is allowed: with `follow` on, the loop adopts the project the Keil IDE shows as soon as one is open |
| `root` | the project's third parent | Where the project picker scans for `.uvprojx` files. Empty disables the scan |
| `uv4` | `UV4.exe` | Keil command-line executable (name on `PATH` or an absolute path) |
| `settleMs` | `1500` | Quiet time after the last change before a round starts |
| `auto` | `true` | Automatic rounds after saved changes |
| `autoFlash` | `true` | Download after a successful build; `false` waits for the panel button |
| `follow` | `true` | Follow the project the Keil IDE currently shows |
| `guard` | `true` | Refuse a download while the IDE shows a different project |
| `port` | *(empty)* | Port reopened after a download; empty leaves reading to the user |
| `baud` | `115200` | Baud rate for that port |

The loop can also be switched on or off from the panel and by the
`build_flash` tool.

## Limits

- Windows only; a machine without PowerShell or Keil reports the failure in the
  panel.
- Reading holds the port exclusively, so another program cannot open it at the
  same time; a download still succeeds when the port is busy, but no boot log
  appears.
- The log keeps text and hex per line, not raw frames: a device that sends
  binary without any CR/LF separator shows up as one growing line (cut at 8192
  bytes).
- Automatic rounds flash the board after every settled edit. Turn the automatic
  switch off while you are only reading code.

