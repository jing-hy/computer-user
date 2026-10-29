# guard.ps1 — always-on-top takeover pill (WPF) plus a global stop hotkey.
#
# Runs as its own process so the stop key still lands while the input backend is
# busy. While it runs, a small pill says the agent is driving the machine;
# pressing the hotkey (default Ctrl+Alt+Esc), clicking Stop, or reaching the
# timeout writes a stop flag that every subsequent computer_* call honours.
#
# WPF (not WinForms) so the text is ClearType-sharp at any DPI and the pill can
# use a real rounded corner plus a soft shadow instead of a chroma-keyed region.
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
  $reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
  $win = [System.Windows.Markup.XamlReader]::Load($reader)

  $win.FindName('TitleText').Text = $title
  $win.FindName('HintText').Text = ($hintTemplate -replace '\{key\}', $hotkey)

  $win.Left = [Math]::Round(([System.Windows.SystemParameters]::PrimaryScreenWidth - $win.Width) / 2)
  $win.Top = 6

  $script:reason = 'timeout'
  $script:registered = $false
  $script:hotkeyId = 0xC0DE

  $stopClick = {
    $script:reason = 'button'
    $win.Close()
  }
  $win.FindName('StopButton').Add_MouseLeftButtonUp($stopClick)

  $win.Add_SourceInitialized({
    try {
      $helper = New-Object System.Windows.Interop.WindowInteropHelper($win)
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

  $started = Get-Date
  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds(120)
  $timer.Add_Tick({
    $msg = New-Object CuGuard+MSG
    while ([CuGuard]::PeekMessage([ref]$msg, [IntPtr]::Zero, 0, 0, 1)) {
      if ($msg.message -eq 0x0312 -and $msg.wParam -eq $script:hotkeyId) { $script:reason = 'hotkey'; $win.Close() }
    }
    $elapsed = ((Get-Date) - $started).TotalMilliseconds
    if ($stopAfterMs -gt 0 -and $elapsed -ge $stopAfterMs) { $script:reason = 'self-test'; $win.Close() }
    if ($timeoutMs -gt 0 -and $elapsed -ge $timeoutMs) { $script:reason = 'timeout'; $win.Close() }
  })
  $timer.Start()

  ([int]$PID) | Out-File -FilePath $pidFile -Encoding ascii -Force
  [void]$win.ShowDialog()
  $timer.Stop()
  if ($script:registered -and $script:hwnd) { [void][CuGuard]::UnregisterHotKey($script:hwnd, $script:hotkeyId) }
  Stop-Guard $script:reason
  Out @{ ok = $true; stopped = $true; reason = $script:reason }
  exit 0
} catch {
  Stop-Guard 'error'
  Out @{ ok = $false; error = $_.Exception.Message }
  exit 0
}
