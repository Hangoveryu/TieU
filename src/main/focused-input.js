const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PANEL_SIZE = { width: 380, height: 520 };
const DEFAULT_MARGIN = 20;
const ANCHOR_GAP = 8;
const FAST_PROBE_TIMEOUT = 80;
const UIA_PROBE_TIMEOUT = 180;
const FIRST_PROBE_TIMEOUT = 900;
const PROBE_READY_TIMEOUT = 3500;

const PROBE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class ClipboardFocusNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int left;
    public int top;
    public int right;
    public int bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int x;
    public int y;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct GUITHREADINFO {
    public int cbSize;
    public int flags;
    public IntPtr hwndActive;
    public IntPtr hwndFocus;
    public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner;
    public IntPtr hwndMoveSize;
    public IntPtr hwndCaret;
    public RECT rcCaret;
  }

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);

  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();

  [DllImport("user32.dll")]
  public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);

  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);

  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr SetFocus(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, UIntPtr dwExtraInfo);
}
"@

function New-RectObject($x, $y, $width, $height, $source, $rootHwnd, $focusHwnd) {
  if ($width -le 0 -or $height -le 0) { return $null }

  $targetHwnd = $rootHwnd
  if ($targetHwnd -eq [IntPtr]::Zero) {
    $targetHwnd = $focusHwnd
  }

  if ($targetHwnd -ne [IntPtr]::Zero) {
    $ancestorHwnd = [ClipboardFocusNative]::GetAncestor($targetHwnd, 2)
    if ($ancestorHwnd -ne [IntPtr]::Zero -and [ClipboardFocusNative]::IsWindow($ancestorHwnd)) {
      $targetHwnd = $ancestorHwnd
    }
  }

  $inputHwnd = $focusHwnd
  if ($inputHwnd -eq [IntPtr]::Zero) {
    $inputHwnd = $targetHwnd
  }

  return [PSCustomObject]@{
    x = [int][Math]::Round($x)
    y = [int][Math]::Round($y)
    width = [int][Math]::Max(2, [Math]::Round($width))
    height = [int][Math]::Max(16, [Math]::Round($height))
    source = $source
    hwnd = $targetHwnd.ToInt64().ToString()
    focusHwnd = $inputHwnd.ToInt64().ToString()
  }
}

function Try-CaretRect {
  try {
    $foreground = [ClipboardFocusNative]::GetForegroundWindow()
    if ($foreground -eq [IntPtr]::Zero) { return $null }

    $threadId = [ClipboardFocusNative]::GetWindowThreadProcessId($foreground, [IntPtr]::Zero)
    if ($threadId -eq 0) { return $null }

    $info = New-Object ClipboardFocusNative+GUITHREADINFO
    $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type]'ClipboardFocusNative+GUITHREADINFO')

    if (-not [ClipboardFocusNative]::GetGUIThreadInfo($threadId, [ref]$info)) { return $null }
    if ($info.hwndCaret -eq [IntPtr]::Zero) { return $null }

    $topLeft = New-Object ClipboardFocusNative+POINT
    $topLeft.x = $info.rcCaret.left
    $topLeft.y = $info.rcCaret.top

    if (-not [ClipboardFocusNative]::ClientToScreen($info.hwndCaret, [ref]$topLeft)) { return $null }

    $width = $info.rcCaret.right - $info.rcCaret.left
    $height = $info.rcCaret.bottom - $info.rcCaret.top
    $focusHwnd = $info.hwndFocus
    if ($focusHwnd -eq [IntPtr]::Zero) { $focusHwnd = $info.hwndCaret }
    return New-RectObject $topLeft.x $topLeft.y $width $height 'caret' $foreground $focusHwnd
  } catch {
    return $null
  }
}

function Try-FocusedControlRect {
  try {
    $foreground = [ClipboardFocusNative]::GetForegroundWindow()
    if ($foreground -eq [IntPtr]::Zero) { return $null }

    $threadId = [ClipboardFocusNative]::GetWindowThreadProcessId($foreground, [IntPtr]::Zero)
    if ($threadId -eq 0) { return $null }

    $info = New-Object ClipboardFocusNative+GUITHREADINFO
    $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type]'ClipboardFocusNative+GUITHREADINFO')

    if (-not [ClipboardFocusNative]::GetGUIThreadInfo($threadId, [ref]$info)) { return $null }
    if ($info.hwndFocus -eq [IntPtr]::Zero) { return $null }

    $classNameBuilder = New-Object System.Text.StringBuilder 256
    [void][ClipboardFocusNative]::GetClassName($info.hwndFocus, $classNameBuilder, $classNameBuilder.Capacity)
    $className = $classNameBuilder.ToString()
    if ($className -notmatch 'Edit|RichEdit|RICHEDIT|ComboBox|Scintilla|WindowsForms.*EDIT') { return $null }

    $rect = New-Object ClipboardFocusNative+RECT
    if (-not [ClipboardFocusNative]::GetWindowRect($info.hwndFocus, [ref]$rect)) { return $null }

    $width = $rect.right - $rect.left
    $height = $rect.bottom - $rect.top
    return New-RectObject $rect.left $rect.top $width $height 'focus' $foreground $info.hwndFocus
  } catch {
    return $null
  }
}

function Try-TerminalWindowRect {
  try {
    $foreground = [ClipboardFocusNative]::GetForegroundWindow()
    if ($foreground -eq [IntPtr]::Zero) { return $null }

    $classNameBuilder = New-Object System.Text.StringBuilder 256
    [void][ClipboardFocusNative]::GetClassName($foreground, $classNameBuilder, $classNameBuilder.Capacity)
    $className = $classNameBuilder.ToString()

    $terminalClass = $className -match 'ConsoleWindowClass|CASCADIA|Windows.UI.Core.CoreWindow'
    $terminalProcess = $false
    if (-not $terminalClass) {
      $processId = Get-WindowProcessId $foreground
      if ($processId -gt 0) {
        try {
          $processName = [System.Diagnostics.Process]::GetProcessById($processId).ProcessName
          $terminalProcess = $processName -match 'WindowsTerminal|OpenConsole|conhost|cmd|powershell|pwsh'
        } catch {
          $terminalProcess = $false
        }
      }
    }
    if (-not ($terminalClass -or $terminalProcess)) { return $null }

    $rect = New-Object ClipboardFocusNative+RECT
    if (-not [ClipboardFocusNative]::GetWindowRect($foreground, [ref]$rect)) { return $null }

    $windowWidth = $rect.right - $rect.left
    $windowHeight = $rect.bottom - $rect.top
    if ($windowWidth -le 0 -or $windowHeight -le 0) { return $null }

    return New-RectObject ($rect.left + 12) ($rect.bottom - 44) ([Math]::Max(80, $windowWidth - 24)) 28 'terminal' $foreground $foreground
  } catch {
    return $null
  }
}

function Try-UIAutomationRect {
  try {
    $element = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $element) { return $null }

    $current = $element.Current
    $controlType = $current.ControlType.ProgrammaticName
    $localizedType = $current.LocalizedControlType
    $editableTypes = @('ControlType.Edit', 'ControlType.Document', 'ControlType.ComboBox')
    $looksEditable = $editableTypes -contains $controlType

    if (-not $looksEditable -and $localizedType) {
      $looksEditable = $localizedType -match 'edit|document|combo|text|input|编辑|输入|文本|文档'
    }

    if (-not $looksEditable) { return $null }

    $rect = $current.BoundingRectangle
    if ($rect.IsEmpty -or $rect.Width -le 0 -or $rect.Height -le 0) { return $null }

    $targetHwnd = [IntPtr]::Zero
    if ($current.NativeWindowHandle -ne 0) {
      $targetHwnd = [IntPtr]::new($current.NativeWindowHandle)
    } else {
      $targetHwnd = [ClipboardFocusNative]::GetForegroundWindow()
    }

    return New-RectObject $rect.Left $rect.Top $rect.Width $rect.Height 'uia' $targetHwnd $targetHwnd
  } catch {
    return $null
  }
}

function Test-ForegroundWindow($hwnd) {
  $foreground = [ClipboardFocusNative]::GetForegroundWindow()
  if ($foreground -eq [IntPtr]::Zero) { return $false }
  if ($foreground -eq $hwnd) { return $true }

  $root = [ClipboardFocusNative]::GetAncestor($foreground, 2)
  return $root -eq $hwnd
}

function Get-WindowProcessId($hwnd) {
  if ($hwnd -eq [IntPtr]::Zero) { return 0 }

  $processIdPtr = [Runtime.InteropServices.Marshal]::AllocHGlobal(4)
  try {
    [Runtime.InteropServices.Marshal]::WriteInt32($processIdPtr, 0)
    [void][ClipboardFocusNative]::GetWindowThreadProcessId($hwnd, $processIdPtr)
    return [Runtime.InteropServices.Marshal]::ReadInt32($processIdPtr)
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($processIdPtr)
  }
}

function Invoke-AppActivateFallback($hwnd) {
  try {
    $processId = Get-WindowProcessId $hwnd
    if ($processId -le 0) { return $false }

    $shell = New-Object -ComObject WScript.Shell
    if (-not $shell.AppActivate($processId)) { return $false }

    Start-Sleep -Milliseconds 120
    return Test-ForegroundWindow $hwnd
  } catch {
    return $false
  }
}

function Unlock-ForegroundPermission {
  $VK_MENU = 0x12
  $KEYEVENTF_KEYUP = 0x0002
  [ClipboardFocusNative]::keybd_event($VK_MENU, 0, 0, [UIntPtr]::Zero)
  [ClipboardFocusNative]::keybd_event($VK_MENU, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 20
}

function Invoke-ActivateWindow($hwnd, $focusHwnd) {
  if ($hwnd -eq [IntPtr]::Zero) { return $false }
  if (-not [ClipboardFocusNative]::IsWindow($hwnd)) { return $false }

  if ([ClipboardFocusNative]::IsIconic($hwnd)) {
    [void][ClipboardFocusNative]::ShowWindow($hwnd, 9)
  }

  $currentForeground = [ClipboardFocusNative]::GetForegroundWindow()
  $currentThreadId = 0
  if ($currentForeground -ne [IntPtr]::Zero) {
    $currentThreadId = [ClipboardFocusNative]::GetWindowThreadProcessId($currentForeground, [IntPtr]::Zero)
  }
  $targetThreadId = [ClipboardFocusNative]::GetWindowThreadProcessId($hwnd, [IntPtr]::Zero)
  $focusThreadId = 0
  if ($focusHwnd -ne [IntPtr]::Zero -and [ClipboardFocusNative]::IsWindow($focusHwnd)) {
    $focusThreadId = [ClipboardFocusNative]::GetWindowThreadProcessId($focusHwnd, [IntPtr]::Zero)
  }
  $helperThreadId = [ClipboardFocusNative]::GetCurrentThreadId()

  $attachedCurrent = $false
  $attachedTarget = $false
  $attachedFocus = $false

  try {
    if ($currentThreadId -ne 0 -and $currentThreadId -ne $helperThreadId) {
      $attachedCurrent = [ClipboardFocusNative]::AttachThreadInput($helperThreadId, $currentThreadId, $true)
    }
    if ($targetThreadId -ne 0 -and $targetThreadId -ne $helperThreadId -and $targetThreadId -ne $currentThreadId) {
      $attachedTarget = [ClipboardFocusNative]::AttachThreadInput($helperThreadId, $targetThreadId, $true)
    }
    if ($focusThreadId -ne 0 -and $focusThreadId -ne $helperThreadId -and $focusThreadId -ne $targetThreadId -and $focusThreadId -ne $currentThreadId) {
      $attachedFocus = [ClipboardFocusNative]::AttachThreadInput($helperThreadId, $focusThreadId, $true)
    }

    [void][ClipboardFocusNative]::BringWindowToTop($hwnd)
    [void][ClipboardFocusNative]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 50

    if (-not (Test-ForegroundWindow $hwnd)) {
      if ($attachedTarget) {
        [void][ClipboardFocusNative]::AttachThreadInput($helperThreadId, $targetThreadId, $false)
        $attachedTarget = $false
      }
      if ($attachedCurrent) {
        [void][ClipboardFocusNative]::AttachThreadInput($helperThreadId, $currentThreadId, $false)
        $attachedCurrent = $false
      }
      [void](Invoke-AppActivateFallback $hwnd)
    }

    if (-not (Test-ForegroundWindow $hwnd)) {
      Unlock-ForegroundPermission
      [ClipboardFocusNative]::SwitchToThisWindow($hwnd, $true)
      [void][ClipboardFocusNative]::SetForegroundWindow($hwnd)
      Start-Sleep -Milliseconds 120
    }

    $activated = Test-ForegroundWindow $hwnd
    if ($activated -and $focusHwnd -ne [IntPtr]::Zero -and [ClipboardFocusNative]::IsWindow($focusHwnd)) {
      [void][ClipboardFocusNative]::SetFocus($focusHwnd)
      Start-Sleep -Milliseconds 30
    }

    return $activated
  } finally {
    if ($attachedFocus) {
      [void][ClipboardFocusNative]::AttachThreadInput($helperThreadId, $focusThreadId, $false)
    }
    if ($attachedTarget) {
      [void][ClipboardFocusNative]::AttachThreadInput($helperThreadId, $targetThreadId, $false)
    }
    if ($attachedCurrent) {
      [void][ClipboardFocusNative]::AttachThreadInput($helperThreadId, $currentThreadId, $false)
    }
  }
}

function Invoke-PasteToWindow($hwndText, $focusHwndText) {
  try {
    $hwndValue = [Int64]::Parse($hwndText)
    $hwnd = [IntPtr]::new($hwndValue)
    $focusHwnd = [IntPtr]::Zero
    if ($focusHwndText) {
      $focusHwndValue = [Int64]::Parse($focusHwndText)
      $focusHwnd = [IntPtr]::new($focusHwndValue)
    }
    if ($hwnd -eq [IntPtr]::Zero) { return $false }
    if (-not [ClipboardFocusNative]::IsWindow($hwnd)) { return $false }

    if (-not (Invoke-ActivateWindow $hwnd $focusHwnd)) { return $false }

    $VK_CONTROL = 0x11
    $VK_V = 0x56
    $KEYEVENTF_KEYUP = 0x0002
    [ClipboardFocusNative]::keybd_event($VK_CONTROL, 0, 0, [UIntPtr]::Zero)
    [ClipboardFocusNative]::keybd_event($VK_V, 0, 0, [UIntPtr]::Zero)
    [ClipboardFocusNative]::keybd_event($VK_V, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    [ClipboardFocusNative]::keybd_event($VK_CONTROL, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    return $true
  } catch {
    return $false
  }
}

function Get-FocusedRect {
  $rect = Try-CaretRect
  if ($null -ne $rect) { return $rect }

  $rect = Try-FocusedControlRect
  if ($null -ne $rect) { return $rect }

  $rect = Try-TerminalWindowRect
  if ($null -ne $rect) { return $rect }

  return Try-UIAutomationRect
}

function Get-FastFocusedRect {
  $rect = Try-CaretRect
  if ($null -ne $rect) { return $rect }

  $rect = Try-FocusedControlRect
  if ($null -ne $rect) { return $rect }

  return Try-TerminalWindowRect
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq 'exit') { break }

  if ($line -match '^rect:(\\d+)$') {
    $requestId = [int]$Matches[1]
    $rect = Get-FocusedRect
    $response = [PSCustomObject]@{
      id = $requestId
      rect = $rect
    } | ConvertTo-Json -Compress -Depth 4

    [Console]::Out.WriteLine($response)
    [Console]::Out.Flush()
  } elseif ($line -match '^rectfast:(\\d+)$') {
    $requestId = [int]$Matches[1]
    $rect = Get-FastFocusedRect
    $response = [PSCustomObject]@{
      id = $requestId
      rect = $rect
    } | ConvertTo-Json -Compress -Depth 4

    [Console]::Out.WriteLine($response)
    [Console]::Out.Flush()
  } elseif ($line -match '^paste:(\\d+):(\\d+)(?::(\\d+))?$') {
    $requestId = [int]$Matches[1]
    $targetHwnd = $Matches[2]
    $focusHwnd = $Matches[3]
    $pasted = Invoke-PasteToWindow $targetHwnd $focusHwnd
    $response = [PSCustomObject]@{
      id = $requestId
      pasted = $pasted
    } | ConvertTo-Json -Compress

    [Console]::Out.WriteLine($response)
    [Console]::Out.Flush()
  }
}
`;

let probeProcess = null;
let probeBuffer = '';
let probeNextId = 1;
let probeReady = false;
let probeScriptPath = null;
let probeHasCompletedRectRequest = false;
const pendingRequests = new Map();
const probeReadyWaiters = new Set();

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function isUsableRect(rect) {
  return rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0;
}

function isEditableControlType(controlType) {
  return [
    'ControlType.Edit',
    'ControlType.Document',
    'ControlType.ComboBox'
  ].includes(controlType);
}

function getDefaultPanelPosition(workArea, panelSize = DEFAULT_PANEL_SIZE) {
  return {
    x: workArea.x + workArea.width - panelSize.width - DEFAULT_MARGIN,
    y: workArea.y + workArea.height - panelSize.height - DEFAULT_MARGIN
  };
}

function placePanelNearRect(anchorRect, workArea, panelSize = DEFAULT_PANEL_SIZE) {
  const minX = workArea.x + ANCHOR_GAP;
  const maxX = workArea.x + workArea.width - panelSize.width - ANCHOR_GAP;
  const minY = workArea.y + ANCHOR_GAP;
  const maxY = workArea.y + workArea.height - panelSize.height - ANCHOR_GAP;

  const x = clamp(anchorRect.x, minX, maxX);
  const belowY = anchorRect.y + anchorRect.height + ANCHOR_GAP;
  const aboveY = anchorRect.y - panelSize.height - ANCHOR_GAP;

  let y;
  if (belowY + panelSize.height <= workArea.y + workArea.height - ANCHOR_GAP) {
    y = belowY;
  } else if (aboveY >= minY) {
    y = aboveY;
  } else {
    y = clamp(anchorRect.y, minY, maxY);
  }

  return { x, y };
}

function getPanelPosition(screen, anchorRect, panelSize = DEFAULT_PANEL_SIZE) {
  if (isUsableRect(anchorRect)) {
    const display = screen.getDisplayMatching(anchorRect);
    return placePanelNearRect(anchorRect, display.workArea, panelSize);
  }

  const display = screen.getPrimaryDisplay();
  return getDefaultPanelPosition(display.workArea, panelSize);
}

function normalizeRect(rect) {
  if (!isUsableRect(rect)) return null;

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    source: rect.source,
    hwnd: rect.hwnd,
    focusHwnd: rect.focusHwnd
  };
}

function createPasteTarget(rect) {
  if (!rect || !rect.hwnd) return null;

  const target = { hwnd: String(rect.hwnd) };
  if (rect.focusHwnd) {
    target.focusHwnd = String(rect.focusHwnd);
  }
  return target;
}

function buildPasteCommand(id, target) {
  if (!target || !target.hwnd) return null;

  const rootHwnd = String(target.hwnd);
  const focusHwnd = target.focusHwnd ? String(target.focusHwnd) : '';
  return focusHwnd
    ? `paste:${id}:${rootHwnd}:${focusHwnd}\n`
    : `paste:${id}:${rootHwnd}\n`;
}

function completeRequest(id, message) {
  const request = pendingRequests.get(id);
  if (!request) return;

  clearTimeout(request.timer);
  pendingRequests.delete(id);

  if (request.type === 'paste') {
    request.resolve(Boolean(message.pasted));
    return;
  }

  probeHasCompletedRectRequest = true;
  request.resolve(normalizeRect(message.rect));
}

function failPendingRequests() {
  for (const [id, request] of pendingRequests) {
    clearTimeout(request.timer);
    request.resolve(null);
    pendingRequests.delete(id);
  }
}

function resolveProbeReadyWaiters(value) {
  for (const waiter of probeReadyWaiters) {
    waiter(value);
  }
  probeReadyWaiters.clear();
}

function handleProbeLine(rawLine) {
  const line = rawLine.trim();
  if (!line || line[0] !== '{') return;

  let message;
  try {
    message = JSON.parse(line);
  } catch (e) {
    return;
  }

  if (message.ready) {
    probeReady = true;
    resolveProbeReadyWaiters(true);
    return;
  }

  if (Number.isInteger(message.id)) {
    completeRequest(message.id, message);
  }
}

function handleProbeOutput(chunk) {
  probeBuffer += chunk.toString('utf8');
  const lines = probeBuffer.split(/\r?\n/);
  probeBuffer = lines.pop() || '';

  for (const line of lines) {
    handleProbeLine(line);
  }
}

function ensureProbeScriptFile() {
  if (probeScriptPath && fs.existsSync(probeScriptPath)) return probeScriptPath;

  probeScriptPath = path.join(os.tmpdir(), `history-clipboard-focused-input-${process.pid}.ps1`);
  const utf8Bom = Buffer.from([0xEF, 0xBB, 0xBF]);
  fs.writeFileSync(probeScriptPath, Buffer.concat([utf8Bom, Buffer.from(PROBE_SCRIPT, 'utf8')]));
  return probeScriptPath;
}

function cleanupProbeScriptFile() {
  if (!probeScriptPath) return;

  try {
    fs.unlinkSync(probeScriptPath);
  } catch (e) {
    // ignore
  }

  probeScriptPath = null;
}

function startFocusedInputProbe() {
  if (process.platform !== 'win32' || probeProcess) return;

  probeReady = false;
  probeHasCompletedRectRequest = false;
  const scriptPath = ensureProbeScriptFile();
  probeProcess = spawn('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath
  ], {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true
  });

  probeProcess.stdout.on('data', handleProbeOutput);
  probeProcess.on('exit', () => {
    probeProcess = null;
    probeReady = false;
    probeBuffer = '';
    failPendingRequests();
    resolveProbeReadyWaiters(false);
    cleanupProbeScriptFile();
  });
  probeProcess.on('error', () => {
    probeProcess = null;
    probeReady = false;
    probeBuffer = '';
    failPendingRequests();
    resolveProbeReadyWaiters(false);
    cleanupProbeScriptFile();
  });
}

function stopFocusedInputProbe() {
  if (!probeProcess) return;

  try {
    probeProcess.stdin.write('exit\n');
  } catch (e) {
    // ignore
  }

  probeProcess.kill();
  probeProcess = null;
  probeReady = false;
  probeBuffer = '';
  failPendingRequests();
  resolveProbeReadyWaiters(false);
  cleanupProbeScriptFile();
}

function waitForFocusedInputProbeReady(timeoutMs = PROBE_READY_TIMEOUT) {
  if (process.platform !== 'win32') return Promise.resolve(false);

  startFocusedInputProbe();
  if (probeReady) return Promise.resolve(true);
  if (!probeProcess || !probeProcess.stdin.writable) return Promise.resolve(false);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      probeReadyWaiters.delete(done);
      resolve(false);
    }, timeoutMs);

    function done(value) {
      clearTimeout(timer);
      resolve(Boolean(value));
    }

    probeReadyWaiters.add(done);
  });
}

function requestFocusedInputRect(timeoutMs, fastOnly = false) {
  if (!probeProcess || !probeProcess.stdin.writable) return Promise.resolve(null);

  const id = probeNextId++;
  const command = fastOnly ? 'rectfast' : 'rect';

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      probeHasCompletedRectRequest = true;
      resolve(null);
    }, timeoutMs);

    pendingRequests.set(id, { resolve, timer, type: 'rect' });

    try {
      probeProcess.stdin.write(`${command}:${id}\n`);
    } catch (e) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      resolve(null);
    }
  });
}

async function readFocusedInputRect(timeoutMs = null) {
  if (process.platform !== 'win32') return null;

  const ready = await waitForFocusedInputProbeReady();
  if (!ready) return null;

  if (timeoutMs) return requestFocusedInputRect(timeoutMs);

  const fastRect = await requestFocusedInputRect(FAST_PROBE_TIMEOUT, true);
  if (fastRect) return fastRect;

  const fullTimeout = probeHasCompletedRectRequest ? UIA_PROBE_TIMEOUT : FIRST_PROBE_TIMEOUT;
  return requestFocusedInputRect(fullTimeout);
}

async function warmUpFocusedInputProbe() {
  if (process.platform !== 'win32') return false;

  const rect = await readFocusedInputRect(FIRST_PROBE_TIMEOUT);
  return Boolean(rect);
}

async function pasteToFocusedTarget(target, timeoutMs = 900) {
  const pasteTarget = typeof target === 'object' ? target : { hwnd: target };
  if (process.platform !== 'win32' || !pasteTarget.hwnd) return Promise.resolve(false);

  const ready = await waitForFocusedInputProbeReady();
  if (!ready) return false;

  if (!probeProcess || !probeProcess.stdin.writable) return Promise.resolve(false);

  const id = probeNextId++;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      resolve(false);
    }, timeoutMs);

    pendingRequests.set(id, { resolve, timer, type: 'paste' });

    try {
      const command = buildPasteCommand(id, pasteTarget);
      if (!command) {
        clearTimeout(timer);
        pendingRequests.delete(id);
        resolve(false);
        return;
      }
      probeProcess.stdin.write(command);
    } catch (e) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      resolve(false);
    }
  });
}

module.exports = {
  DEFAULT_PANEL_SIZE,
  getDefaultPanelPosition,
  getPanelPosition,
  isEditableControlType,
  isUsableRect,
  placePanelNearRect,
  buildPasteCommand,
  createPasteTarget,
  readFocusedInputRect,
  pasteToFocusedTarget,
  warmUpFocusedInputProbe,
  waitForFocusedInputProbeReady,
  startFocusedInputProbe,
  stopFocusedInputProbe
};
