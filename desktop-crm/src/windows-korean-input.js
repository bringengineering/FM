"use strict";

const path = require("node:path");
const { spawn: nodeSpawn } = require("node:child_process");

// This helper only selects an already-installed Korean input locale for the
// currently focused CRM window. It never installs a layout or changes Windows
// language settings globally.
const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BringKoreanInputNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int left;
    public int top;
    public int right;
    public int bottom;
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
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] public static extern int GetKeyboardLayoutList(int size, [Out] IntPtr[] list);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("imm32.dll")] public static extern IntPtr ImmGetContext(IntPtr hWnd);
  [DllImport("imm32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ImmSetOpenStatus(IntPtr context, bool open);
  [DllImport("imm32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ImmReleaseContext(IntPtr hWnd, IntPtr context);
}
'@

function Set-BringKoreanInput([string]$rawTarget) {
  [long]$targetValue = 0
  if (-not [long]::TryParse($rawTarget, [ref]$targetValue) -or $targetValue -le 0) { return }
  $target = [IntPtr]::new($targetValue)
  $foreground = [BringKoreanInputNative]::GetForegroundWindow()
  if ($foreground -eq [IntPtr]::Zero) { return }
  if ([BringKoreanInputNative]::GetAncestor($foreground, 2) -ne $target) { return }

  $count = [BringKoreanInputNative]::GetKeyboardLayoutList(0, $null)
  if ($count -le 0) { return }
  $layouts = [IntPtr[]]::new($count)
  if ([BringKoreanInputNative]::GetKeyboardLayoutList($count, $layouts) -le 0) { return }
  $korean = [IntPtr]::Zero
  foreach ($layout in $layouts) {
    if (($layout.ToInt64() -band 0xffff) -eq 0x0412) { $korean = $layout; break }
  }
  if ($korean -eq [IntPtr]::Zero) { return }

  $threadId = [BringKoreanInputNative]::GetWindowThreadProcessId($foreground, [IntPtr]::Zero)
  $info = [BringKoreanInputNative+GUITHREADINFO]::new()
  $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][BringKoreanInputNative+GUITHREADINFO])
  $focusWindow = $foreground
  if ($threadId -gt 0 -and [BringKoreanInputNative]::GetGUIThreadInfo($threadId, [ref]$info) -and $info.hwndFocus -ne [IntPtr]::Zero) {
    $focusWindow = $info.hwndFocus
  }
  if (-not [BringKoreanInputNative]::PostMessage($focusWindow, 0x0050, [IntPtr]::Zero, $korean)) { return }
  Start-Sleep -Milliseconds 35
  $context = [BringKoreanInputNative]::ImmGetContext($focusWindow)
  if ($context -ne [IntPtr]::Zero) {
    [void][BringKoreanInputNative]::ImmSetOpenStatus($context, $true)
    [void][BringKoreanInputNative]::ImmReleaseContext($focusWindow, $context)
  }
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
  try { Set-BringKoreanInput $line } catch { }
}
`;

const ENCODED_COMMAND = Buffer.from(POWERSHELL_SCRIPT, "utf16le").toString("base64");

function nativeHandleDecimal(windowRef) {
  const handle = windowRef.getNativeWindowHandle();
  if (!Buffer.isBuffer(handle) || !handle.length) return "";
  if (handle.length >= 8 && typeof handle.readBigUInt64LE === "function") return handle.readBigUInt64LE(0).toString(10);
  if (handle.length >= 4) return String(handle.readUInt32LE(0));
  return "";
}

function safeChildEnvironment(source) {
  const env = {};
  for (const key of ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP", "PSModulePath"]) {
    if (typeof source[key] === "string" && source[key]) env[key] = source[key];
  }
  return env;
}

function createController(options = {}) {
  const platform = options.platform || process.platform;
  const sourceEnv = options.env || process.env;
  const systemRoot = sourceEnv.SystemRoot || sourceEnv.WINDIR || "C:\\Windows";
  const powershell = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const spawn = options.spawn || nodeSpawn;
  let child = null;

  function start() {
    if (platform !== "win32") return false;
    if (child && child.stdin && !child.stdin.destroyed) return true;
    try {
      child = spawn(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED_COMMAND], {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "ignore", "ignore"],
        env: safeChildEnvironment(sourceEnv),
      });
      const current = child;
      const reset = () => { if (child === current) child = null; };
      child.once("error", reset);
      child.once("exit", reset);
      child.stdin?.once("error", reset);
      return Boolean(child.stdin);
    } catch (_) {
      child = null;
      return false;
    }
  }

  function warm() {
    return platform === "win32" && start();
  }

  async function requestKoreanInput(windowRef) {
    if (platform !== "win32") return { ok: false, reason: "unsupported" };
    if (!windowRef || windowRef.isDestroyed()) return { ok: false, reason: "window-unavailable" };
    if (typeof windowRef.isFocused === "function" && !windowRef.isFocused()) return { ok: false, reason: "window-unfocused" };
    const hwnd = nativeHandleDecimal(windowRef);
    if (!hwnd) return { ok: false, reason: "window-handle-unavailable" };
    if (!start()) return { ok: false, reason: "unavailable" };
    try {
      child.stdin.write(`${hwnd}\n`);
      return { ok: true };
    } catch (_) {
      child = null;
      return { ok: false, reason: "unavailable" };
    }
  }

  function stop() {
    const current = child;
    child = null;
    if (!current) return;
    try { current.stdin?.end(); } catch (_) {}
    const timer = setTimeout(() => { try { current.kill(); } catch (_) {} }, 250);
    timer.unref?.();
  }

  return Object.freeze({ requestKoreanInput, stop, warm });
}

const defaultController = createController();

module.exports = Object.freeze({
  POWERSHELL_SCRIPT,
  createController,
  requestKoreanInput: windowRef => defaultController.requestKoreanInput(windowRef),
  stop: () => defaultController.stop(),
  warm: () => defaultController.warm(),
});
