# guard.ps1 — always-on-top takeover indicator plus a global stop hotkey.
#
# Runs as its own process so the stop key still works while the input backend is
# busy (the same reason the head of the ecosystem uses a separate listener).
# While it runs, a small pill says the agent is driving the machine; pressing the
# hotkey (default Ctrl+Alt+Esc), clicking the button, or reaching the timeout
# writes a stop flag that every subsequent computer_* call refuses to ignore.
#
# Protocol: -Json carries a base64 payload; the script prints one JSON object
# and exits for the one-shot modes, or stays resident for mode=run.
param([string]$Json)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false; $OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }

function Out($o) { $o | ConvertTo-Json -Depth 6 -Compress }

function Get-Payload {
  if ([string]::IsNullOrEmpty($Json)) { return @{} }
  $raw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Json))
  return ($raw | ConvertFrom-Json)
}

$stateDir = Join-Path $env:TEMP 'computer-user'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$stopFlag = Join-Path $stateDir 'stop.flag'
$pidFile = Join-Path $stateDir 'guard.pid'

function Stop-Guard([string]$reason) {
  try { ('reason=' + $reason + ' at=' + (Get-Date).ToString('o')) | Out-File -FilePath $stopFlag -Encoding utf8 } catch { }
  try { if (Test-Path $pidFile) { Remove-Item $pidFile -Force } } catch { }
  try { $info = Join-Path $stateDir 'guard.json'; if (Test-Path $info) { Remove-Item $info -Force } } catch { }
}

try {
  $payload = Get-Payload
  $mode = [string]$payload.mode
  if ($mode -eq 'status') {
    $running = $false
    if (Test-Path $pidFile) {
      $raw = (Get-Content $pidFile -Raw -ErrorAction SilentlyContinue)
      $probe = 0
      if ([int]::TryParse(($raw -as [string]).Trim(), [ref]$probe)) {
        $running = $null -ne (Get-Process -Id $probe -ErrorAction SilentlyContinue)
      }
    }
    Out @{ ok = $true; running = $running; stopped = (Test-Path $stopFlag); stateDir = $stateDir }
    exit 0
  }
  if ($mode -eq 'clear') {
    if (Test-Path $stopFlag) { Remove-Item $stopFlag -Force }
    Out @{ ok = $true; cleared = $true }
    exit 0
  }
  if ($mode -eq 'stop') {
    Stop-Guard 'external'
    Out @{ ok = $true; stopped = $true }
    exit 0
  }

  # Resident mode: show the pill and wait for the hotkey.
  $hotkey = 'ctrl+alt+esc'
  if ($payload.hotkey) { $hotkey = [string]$payload.hotkey }
  $message = 'DSH is controlling your computer. Press {key} to stop.'
  if ($payload.message) { $message = [string]$payload.message }
  $timeoutMs = 0
  if ($payload.timeoutMs) { $timeoutMs = [int]$payload.timeoutMs }
  $stopAfterMs = 0
  if ($payload.stopAfterMs) { $stopAfterMs = [int]$payload.stopAfterMs }

  $mods = 0
  $vk = 0x1B
  $parts = $hotkey.ToLower().Split('+')
  foreach ($part in $parts) {
    $k = $part.Trim()
    if ($k -eq 'ctrl' -or $k -eq 'control') { $mods = $mods -bor 0x0002 }
    elseif ($k -eq 'alt') { $mods = $mods -bor 0x0001 }
    elseif ($k -eq 'shift') { $mods = $mods -bor 0x0004 }
    elseif ($k -eq 'win' -or $k -eq 'super') { $mods = $mods -bor 0x0008 }
    elseif ($k -match '^f([1-9]|1[0-9]|2[0-4])$') { $vk = 0x6F + [int]$k.Substring(1) }
    elseif ($k -eq 'esc' -or $k -eq 'escape') { $vk = 0x1B }
    elseif ($k -eq 'space') { $vk = 0x20 }
    elseif ($k.Length -eq 1) { $vk = [int][char]$k.ToUpper() }
    else { $vk = 0x1B }
  }

  $script:HotkeyMods = $mods
  $script:HotkeyVk = $vk
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  Add-Type -AssemblyName System.Drawing | Out-Null
  $native = @'
using System;
using System.Runtime.InteropServices;
public static class CuGuard {
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern bool PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);
}
'@
  if (-not ('CuGuard' -as [type])) { Add-Type -TypeDefinition $native | Out-Null }

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'computer-user takeover'
  $form.FormBorderStyle = 'None'
  $form.StartPosition = 'Manual'
  $form.TopMost = $true
  $form.ShowInTaskbar = $false
  $form.Width = 540
  $form.Height = 54
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $form.Left = $screen.Left + [int](($screen.Width - $form.Width) / 2)
  $form.Top = $screen.Top + 14
  $form.BackColor = [System.Drawing.Color]::FromArgb(27, 102, 240)
  $form.Opacity = 0.96

  $radius = 14
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $radius * 2, $radius * 2, 180, 90)
  $path.AddArc($form.Width - $radius * 2 - 1, 0, $radius * 2, $radius * 2, 270, 90)
  $path.AddArc($form.Width - $radius * 2 - 1, $form.Height - $radius * 2 - 1, $radius * 2, $radius * 2, 0, 90)
  $path.AddArc(0, $form.Height - $radius * 2 - 1, $radius * 2, $radius * 2, 90, 90)
  $path.CloseFigure()
  $form.Region = New-Object System.Drawing.Region($path)

  $label = New-Object System.Windows.Forms.Label
  $label.Text = ($message -replace '\{key\}', $hotkey)
  $label.ForeColor = [System.Drawing.Color]::White
  $label.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Regular)
  $label.TextAlign = 'MiddleLeft'
  $label.Left = 22
  $label.Top = 10
  $label.Width = 430
  $label.Height = 34
  $label.BackColor = [System.Drawing.Color]::Transparent
  $label.Add_Click({ $script:reason = 'button'; $form.Close() })

  $button = New-Object System.Windows.Forms.Label
  $button.Text = 'Stop'
  $button.ForeColor = [System.Drawing.Color]::White
  $button.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
  $button.TextAlign = 'MiddleCenter'
  $button.Width = 70
  $button.Height = 28
  $button.Left = $form.Width - $button.Width - 16
  $button.Top = 13
  $button.BackColor = [System.Drawing.Color]::FromArgb(255, 255, 255)
  $button.ForeColor = [System.Drawing.Color]::FromArgb(27, 102, 240)
  $btnRadius = 13
  $btnPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $btnPath.AddArc(0, 0, $btnRadius * 2, $btnRadius * 2, 180, 90)
  $btnPath.AddArc($button.Width - $btnRadius * 2 - 1, 0, $btnRadius * 2, $btnRadius * 2, 270, 90)
  $btnPath.AddArc($button.Width - $btnRadius * 2 - 1, $button.Height - $btnRadius * 2 - 1, $btnRadius * 2, $btnRadius * 2, 0, 90)
  $btnPath.AddArc(0, $button.Height - $btnRadius * 2 - 1, $btnRadius * 2, $btnRadius * 2, 90, 90)
  $btnPath.CloseFigure()
  $button.Region = New-Object System.Drawing.Region($btnPath)
  $button.Add_Click({ $script:reason = 'button'; $form.Close() })

  $form.Controls.Add($label)
  $form.Controls.Add($button)

  $script:reason = 'timeout'
  $script:hotkeyId = 0xC0DE
  $registered = $false

  $form.Add_Shown({
    $script:registered = [CuGuard]::RegisterHotKey($form.Handle, $script:hotkeyId, [uint32]$script:HotkeyMods, [uint32]$script:HotkeyVk)
    try {
      $info = @{
        pid = [int]$PID
        hotkey = $hotkey
        registered = [bool]$script:registered
        startedAt = (Get-Date).ToString('o')
      }
      ($info | ConvertTo-Json -Compress) | Out-File -FilePath (Join-Path $stateDir 'guard.json') -Encoding utf8
    } catch { }
  })
  $form.Add_FormClosing({ param($s, $e) })

  $started = Get-Date
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 120
  $timer.Add_Tick({
    $msg = New-Object CuGuard+MSG
    while ([CuGuard]::PeekMessage([ref]$msg, [IntPtr]::Zero, 0, 0, 1)) {
      if ($msg.message -eq 0x0312 -and $msg.wParam -eq $script:hotkeyId) { $script:reason = 'hotkey'; $form.Close() }
    }
    $elapsed = ((Get-Date) - $started).TotalMilliseconds
    if ($stopAfterMs -gt 0 -and $elapsed -ge $stopAfterMs) { $script:reason = 'self-test'; $form.Close() }
    if ($timeoutMs -gt 0 -and $elapsed -ge $timeoutMs) { $script:reason = 'timeout'; $form.Close() }
  })
  $timer.Start()

  ([int]$PID) | Out-File -FilePath $pidFile -Encoding ascii -Force
  [void]$form.ShowDialog()
  $timer.Stop()
  if ($script:registered) { [void][CuGuard]::UnregisterHotKey($form.Handle, $script:hotkeyId) }
  Stop-Guard $script:reason
  Out @{ ok = $true; stopped = $true; reason = $script:reason }
  exit 0
} catch {
  Stop-Guard 'error'
  Out @{ ok = $false; error = $_.Exception.Message }
  exit 0
}
