# guard.ps1 — always-on-top takeover pill (WPF) plus a global stop hotkey.
#
# Runs as its own process so the stop key still lands while the input backend is
# busy. While it runs, a small pill says the agent is driving the machine;
# pressing the hotkey (default Ctrl+Alt+Esc), clicking Stop, or reaching the
# timeout writes a stop flag that every subsequent computer_* call honours.
#
# The pill follows virtual-desktop switches: a normal window belongs to the
# desktop it was created on, so when the user flips desktops the window rebuilds
# itself on the current one (public IVirtualDesktopManager check — no
# undocumented COM). It also re-asserts topmost so another always-on-top window
# cannot bury it.
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
  try { $lock = Join-Path $stateDir 'guard.lock'; if (Test-Path $lock) { Remove-Item $lock -Force } } catch { }
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

  $hotkey = 'ctrl+alt+esc'
  if ($payload.hotkey) { $hotkey = [string]$payload.hotkey }
  $title = 'DSH is controlling your computer'
  if ($payload.message) { $title = [string]$payload.message }
  $hintTemplate = 'Do not touch the mouse. Press {key} to stop.'
  if ($payload.hint) { $hintTemplate = [string]$payload.hint }
  $timeoutMs = 0
  if ($payload.timeoutMs) { $timeoutMs = [int]$payload.timeoutMs }
  $stopAfterMs = 0
  if ($payload.stopAfterMs) { $stopAfterMs = [int]$payload.stopAfterMs }
  $hintText = ($hintTemplate -replace '\{key\}', $hotkey)

  $mods = 0
  $vk = 0x1B
  foreach ($part in $hotkey.ToLower().Split('+')) {
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

  Add-Type -AssemblyName PresentationFramework | Out-Null
  Add-Type -AssemblyName PresentationCore | Out-Null
  Add-Type -AssemblyName WindowsBase | Out-Null
  $native = @'
using System;
using System.Runtime.InteropServices;
public static class CuGuard {
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern bool PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOACTIVATE = 0x0010;
  public static void Raise(IntPtr h) { SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); }
}
[ComImport, Guid("A5CD92FF-29BE-454C-8D04-D82879FB3F1B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IVirtualDesktopManager {
  int IsWindowOnCurrentVirtualDesktop(IntPtr hwnd, out int onCurrentDesktop);
  int GetWindowDesktopId(IntPtr hwnd, out Guid desktopId);
  int MoveWindowToDesktop(IntPtr hwnd, ref Guid desktopId);
}
[ComImport, Guid("AA509086-5CA9-4C25-8F95-589D3C07B48A")]
public class VirtualDesktopManagerCoClass { }
public static class CuDesktop {
  static IVirtualDesktopManager manager;
  static IVirtualDesktopManager Manager {
    get {
      if (manager == null) manager = (IVirtualDesktopManager)new VirtualDesktopManagerCoClass();
      return manager;
    }
  }
  public static bool IsOnCurrent(IntPtr hwnd) {
    try {
      int ok;
      manager = Manager;
      int hr = manager.IsWindowOnCurrentVirtualDesktop(hwnd, out ok);
      if (hr != 0) return true;
      return ok != 0;
    } catch { return true; }
  }
}
'@
  if (-not ('CuGuard' -as [type])) { Add-Type -TypeDefinition $native | Out-Null }

  $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ResizeMode="NoResize"
        WindowStartupLocation="Manual" Width="744" Height="112" Opacity="1">
  <Grid Margin="22,18,22,18">
  <Border CornerRadius="18" Background="#1B66F0" Padding="20,0">
    <Border.Effect>
      <DropShadowEffect BlurRadius="28" ShadowDepth="6" Opacity="0.35" Color="#000000"/>
    </Border.Effect>
    <Grid>
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="Auto"/>
        <ColumnDefinition Width="*"/>
        <ColumnDefinition Width="Auto"/>
      </Grid.ColumnDefinitions>
      <Border Grid.Column="0" Width="10" Height="10" CornerRadius="5" Background="#E8F0FF"
              VerticalAlignment="Center" Margin="0,0,16,0"/>
      <StackPanel Grid.Column="1" VerticalAlignment="Center">
        <TextBlock x:Name="TitleText" Foreground="#FFFFFF" FontFamily="Segoe UI" FontSize="16"
                   FontWeight="SemiBold" TextTrimming="CharacterEllipsis"/>
        <TextBlock x:Name="HintText" Foreground="#CFE0FF" FontFamily="Segoe UI" FontSize="12.5"
                   Margin="0,3,0,0"/>
      </StackPanel>
      <Border x:Name="StopButton" Grid.Column="2" Background="#FFFFFF" CornerRadius="16"
              Padding="20,8" VerticalAlignment="Center" Cursor="Hand">
        <TextBlock Text="Stop" Foreground="#1B66F0" FontFamily="Segoe UI" FontSize="13.5" FontWeight="SemiBold"/>
      </Border>
    </Grid>
  </Border>
  </Grid>
</Window>
'@

  $makeWindow = {
    $reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
    $w = [System.Windows.Markup.XamlReader]::Load($reader)
    $w.FindName('TitleText').Text = $title
    $w.FindName('HintText').Text = $hintText
    $w.Left = [Math]::Round(([System.Windows.SystemParameters]::PrimaryScreenWidth - $w.Width) / 2)
    $w.Top = 6
    $script:currentWindow = $w
    $w.FindName('StopButton').Add_MouseLeftButtonUp({ $script:reason = 'button'; $script:currentWindow.Close() })
    return $w
  }

  $script:reason = 'timeout'
  $script:desktopSwitch = $false
  $script:hotkeyId = 0xC0DE
  $script:started = Get-Date
  $pidFileWritten = $false

  while ($true) {
    $script:desktopSwitch = $false
    $script:registered = $false
    $win = & $makeWindow
    $thisWin = $win

    $win.Add_SourceInitialized({
      try {
        $helper = New-Object System.Windows.Interop.WindowInteropHelper($thisWin)
        $script:hwnd = $helper.Handle
        $script:registered = [CuGuard]::RegisterHotKey($script:hwnd, $script:hotkeyId, [uint32]$mods, [uint32]$vk)
        $info = @{
          pid = [int]$PID
          hotkey = $hotkey
          registered = [bool]$script:registered
          startedAt = (Get-Date).ToString('o')
        }
        ($info | ConvertTo-Json -Compress) | Out-File -FilePath (Join-Path $stateDir 'guard.json') -Encoding utf8
      } catch { }
    })

    $timer = New-Object System.Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(150)
    $tick = 0
    $timer.Add_Tick({
      $msg = New-Object CuGuard+MSG
      while ([CuGuard]::PeekMessage([ref]$msg, [IntPtr]::Zero, 0, 0, 1)) {
        if ($msg.message -eq 0x0312 -and $msg.wParam -eq $script:hotkeyId) { $script:reason = 'hotkey'; $script:currentWindow.Close() }
      }
      $script:tick = $script:tick + 1
      if ($script:hwnd -and ($script:tick % 10) -eq 0) {
        try {
          $onCurrent = [CuDesktop]::IsOnCurrent($script:hwnd)
          try {
            $logPath = Join-Path $stateDir 'guard.desktop.log'
            $line = 'tick=' + $script:tick + ' hwnd=' + $script:hwnd + ' onCurrent=' + $onCurrent + ' at=' + (Get-Date).ToString('HH:mm:ss.fff')
            $line | Out-File -FilePath $logPath -Append -Encoding utf8
            if ((Get-Item $logPath).Length -gt 262144) { $line | Out-File -FilePath $logPath -Encoding utf8 }
          } catch { }
          if (-not $onCurrent) {
            $script:reason = 'desktop-switch'
            $script:desktopSwitch = $true
            $script:currentWindow.Close()
            return
          }
          [CuGuard]::Raise($script:hwnd)
        } catch { }
      }
      $elapsed = ((Get-Date) - $script:started).TotalMilliseconds
      if ($stopAfterMs -gt 0 -and $elapsed -ge $stopAfterMs) { $script:reason = 'self-test'; $script:currentWindow.Close() }
      if ($timeoutMs -gt 0 -and $elapsed -ge $timeoutMs) { $script:reason = 'timeout'; $script:currentWindow.Close() }
    })
    $timer.Start()

    if (-not $pidFileWritten) {
      ([int]$PID) | Out-File -FilePath $pidFile -Encoding ascii -Force
      $pidFileWritten = $true
    }

    [void]$win.ShowDialog()
    $timer.Stop()
    if ($script:registered -and $script:hwnd) { [void][CuGuard]::UnregisterHotKey($script:hwnd, $script:hotkeyId) }

    if ($script:desktopSwitch) {
      Start-Sleep -Milliseconds 120
      continue
    }
    break
  }

  Stop-Guard $script:reason
  Out @{ ok = $true; stopped = $true; reason = $script:reason }
  exit 0
} catch {
  Stop-Guard 'error'
  Out @{ ok = $false; error = $_.Exception.Message }
  exit 0
}
