# observe.ps1 — UIA observation, window control, and targeted control actions.
#
# Protocol matches capture.ps1/input.ps1: take a base64 JSON payload in -Json,
# print one compact JSON object with a boolean "ok".
#
# Actions:
#   probe       environment self-check (PowerShell, UIA assemblies, temp dir)
#   windows     list top-level windows (handle, title, pid, process, rect)
#   snapshot    bounded UIA tree of one window + a stable locator per element
#   act         run one control action (invoke | set_value | focus | select)
#   window      window control (activate | move | close)
#   wait        poll for a window / locator / title substring
#   foreground  read the current foreground window (stale-observation check)
#
# Locators are stable, replayable strings: hwnd=<h>|role=<Role>|name=<Name>|nth=<n>
# (the short form h=|r=|n=|i= is accepted too). They are resolved against a
# fresh tree on every call, so a stale locator fails loudly instead of clicking
# whatever now sits at the old coordinates.
param([string]$Json)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false; $OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }

function Out($o) { $o | ConvertTo-Json -Depth 12 -Compress }

function Get-Payload {
  $raw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Json))
  return ($raw | ConvertFrom-Json)
}

function Require-Uia {
  Add-Type -AssemblyName UIAutomationClient | Out-Null
  Add-Type -AssemblyName UIAutomationTypes | Out-Null
  Add-Type -AssemblyName WindowsBase | Out-Null
}

function Require-Win32 {
  $sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CuWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool repaint);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
}
'@
  if (-not ('CuWin' -as [type])) { Add-Type -TypeDefinition $sig | Out-Null }
}

function Get-Role($el) {
  try { return ($el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '') } catch { return 'Unknown' }
}

function Get-Rect($el) {
  try {
    $r = $el.Current.BoundingRectangle
    if ($r.IsEmpty) { return $null }
    return @{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
  } catch { return $null }
}

function Get-ForegroundInfo {
  Require-Win32
  $h = [CuWin]::GetForegroundWindow()
  $sb = New-Object Text.StringBuilder 512
  [void][CuWin]::GetWindowText($h, $sb, $sb.Capacity)
  $procId = 0
  [void][CuWin]::GetWindowThreadProcessId($h, [ref]$procId)
  return @{ handle = [int64]$h; title = $sb.ToString(); pid = $procId }
}

function Get-ProcessName($procId) {
  try { return (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { return '' }
}

function Get-WindowInfo([int64]$h) {
  Require-Win32
  $sb = New-Object Text.StringBuilder 512
  [void][CuWin]::GetWindowText([IntPtr]$h, $sb, $sb.Capacity)
  $procId = 0
  [void][CuWin]::GetWindowThreadProcessId([IntPtr]$h, [ref]$procId)
  return @{ handle = $h; title = $sb.ToString(); pid = $procId; process = (Get-ProcessName $procId) }
}

function Get-WindowElement([string]$handle) {
  $h = [int64]$handle
  try {
    $el = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$h)
    if ($el -ne $null) { return $el }
  } catch { }
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = [System.Windows.Automation.Condition]::TrueCondition
  $kids = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  for ($i = 0; $i -lt $kids.Count; $i++) {
    $e = $kids.Item($i)
    try { if ([int64]$e.Current.NativeWindowHandle -eq $h) { return $e } } catch { }
  }
  return $null
}

function Get-WindowList {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = [System.Windows.Automation.Condition]::TrueCondition
  $kids = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  $out = @()
  for ($i = 0; $i -lt $kids.Count; $i++) {
    $e = $kids.Item($i)
    if ($e.Current.IsOffscreen) { continue }
    if ([int64]$e.Current.NativeWindowHandle -eq 0) { continue }
    $out += @{
      handle = [int64]$e.Current.NativeWindowHandle
      title = $e.Current.Name
      pid = $e.Current.ProcessId
      process = Get-ProcessName $e.Current.ProcessId
      rect = Get-Rect $e
      focused = $e.Current.HasKeyboardFocus
    }
  }
  return $out
}

function New-UiaNode($el) {
  $role = Get-Role $el
  $name = ''
  try { $name = $el.Current.Name } catch { }
  $autoId = ''
  try { $autoId = $el.Current.AutomationId } catch { }
  $key = '' + $role + '|' + $name + '|' + $autoId
  $nth = 0
  if ($script:CU_Seen.ContainsKey($key)) { $nth = $script:CU_Seen[$key] + 1 }
  $script:CU_Seen[$key] = $nth
  $node = @{
    element = $el
    role = $role
    name = $name
    autoId = $autoId
    nth = $nth
    rect = (Get-Rect $el)
    enabled = $true
    focusable = $false
    value = $null
  }
  try { $node.enabled = $el.Current.IsEnabled } catch { }
  try { $node.focusable = $el.Current.IsKeyboardFocusable } catch { }
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($vp -ne $null) { $node.value = $vp.Current.Value }
  } catch { }
  return $node
}

function Walk-Tree($el, [int]$depth, [int]$maxDepth) {
  $out = New-Object System.Collections.ArrayList
  if ($depth -gt $maxDepth) { return ,$out }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $child = $walker.GetFirstChild($el)
  if ($child -eq $null) { $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker; $child = $walker.GetFirstChild($el) }
  while ($child -ne $null) {
    if ($script:CU_Budget -le 0) { break }
    $script:CU_Budget = $script:CU_Budget - 1
    [void]$out.Add((New-UiaNode $child))
    $sub = Walk-Tree $child ($depth + 1) $maxDepth
    foreach ($x in $sub) { [void]$out.Add($x) }
    $child = $walker.GetNextSibling($child)
  }
  return ,$out
}

function Collect-Nodes($win, [int]$maxDepth, [int]$maxNodes) {
  $script:CU_Budget = $maxNodes
  $script:CU_Seen = @{}
  return ,(Walk-Tree $win 0 $maxDepth)
}

function New-Locator($handle, $node) {
  $safe = ($node.name -replace '\|', '/')
  $auto = ($node.autoId -replace '\|', '/')
  return 'hwnd=' + $handle + '|role=' + $node.role + '|name=' + $safe + '|nth=' + $node.nth + '|auto=' + $auto
}

function Parse-Locator([string]$locator) {
  $map = @{}
  $alias = @{ h = 'hwnd'; r = 'role'; n = 'name'; i = 'nth'; a = 'auto' }
  foreach ($part in $locator.Split('|')) {
    $kv = $part.Split('=', 2)
    if ($kv.Count -eq 2) {
      $k = $kv[0]
      if ($alias.ContainsKey($k)) { $k = $alias[$k] }
      $map[$k] = $kv[1]
    }
  }
  return $map
}

function Find-ElementByLocator([string]$locator) {
  $map = Parse-Locator $locator
  if (-not $map.ContainsKey('hwnd')) { return $null }
  $win = Get-WindowElement $map['hwnd']
  if ($win -eq $null) { return $null }
  $nodes = Collect-Nodes $win 12 2000
  foreach ($n in $nodes) {
    if ($n.role -ne $map['role']) { continue }
    $wantName = $map['name']
    if ($wantName -ne $null -and $n.name -ne $wantName) { continue }
    # An automation id pins the control even when the occurrence index drifts
    # between a shallow snapshot and a deeper re-walk.
    if ($map.ContainsKey('auto') -and $map['auto'] -ne '') {
      if ([string]$n.autoId -ne $map['auto']) { continue }
      return @{ window = $win; element = $n.element; node = $n }
    }
    if ($map.ContainsKey('nth') -and ([string]$n.nth) -ne $map['nth']) { continue }
    return @{ window = $win; element = $n.element; node = $n }
  }
  return $null
}

try {
  $p = Get-Payload
  $action = [string]$p.action

  switch ($action) {
    'probe' {
      $uiaOk = $false
      $uiaError = ''
      try { Require-Uia; $uiaOk = $true } catch { $uiaError = $_.Exception.Message }
      $temp = Join-Path $env:TEMP 'computer-user'
      $writable = $false
      try {
        New-Item -ItemType Directory -Force -Path $temp | Out-Null
        $probeFile = Join-Path $temp 'probe.tmp'
        'ok' | Out-File -FilePath $probeFile -Encoding ascii
        $writable = (Test-Path $probeFile)
        Remove-Item $probeFile -Force
      } catch { }
      Out @{
        ok = $true
        powershell = $PSVersionTable.PSVersion.ToString()
        edition = $PSVersionTable.PSEdition
        uia = $uiaOk
        uiaError = $uiaError
        tempDir = $temp
        tempWritable = $writable
        os = [Environment]::OSVersion.VersionString
      }
      exit 0
    }
    'windows' {
      Require-Uia
      Out @{ ok = $true; windows = @(Get-WindowList) }
      exit 0
    }
    'foreground' {
      Require-Uia
      Out @{ ok = $true; foreground = (Get-ForegroundInfo) }
      exit 0
    }
    'snapshot' {
      Require-Uia
      $fg = Get-ForegroundInfo
      $handle = $p.handle
      if ($handle -eq $null -or [int64]$handle -eq 0) { $handle = $fg.handle }
      $win = Get-WindowElement $handle
      if ($win -eq $null) { Out @{ ok = $false; error = ('window not found: hwnd=' + $handle) }; exit 0 }
      $winInfo = Get-WindowInfo ([int64]$handle)
      $maxDepth = 6
      if ($p.maxDepth) { $maxDepth = [int]$p.maxDepth }
      $maxNodes = 80
      if ($p.maxNodes) { $maxNodes = [int]$p.maxNodes }
      $nodes = Collect-Nodes $win $maxDepth $maxNodes
      $trimmed = @()
      foreach ($n in $nodes) {
        $trimmed += @{
          id = (New-Locator $handle $n)
          role = $n.role
          name = $n.name
          autoId = $n.autoId
          rect = $n.rect
          enabled = $n.enabled
          focusable = $n.focusable
          value = $n.value
        }
      }
      Out @{
        ok = $true
        observation = @{
          window = $winInfo
          capturedAt = [DateTime]::UtcNow.ToString('o')
          foregroundHandle = $fg.handle
          foregroundTitle = $fg.title
          maxDepth = $maxDepth
          maxNodes = $maxNodes
          truncated = ($script:CU_Budget -le 0)
        }
        elements = $trimmed
      }
      exit 0
    }
    'act' {
      Require-Uia
      $kind = [string]$p.kind
      $fg = Get-ForegroundInfo
      $hit = Find-ElementByLocator ([string]$p.locator)
      if ($hit -eq $null) { Out @{ ok = $false; error = ('target not found (stale or invalid locator): ' + [string]$p.locator) }; exit 0 }
      $el = $hit.element
      $winHandle = Parse-Locator ([string]$p.locator)['hwnd']
      $winHandle = [int64]$winHandle
      if ($p.requireForeground -eq $true -and $fg.handle -ne $winHandle) {
        Out @{ ok = $false; error = ('stale observation: foreground is hwnd=' + $fg.handle + ' but the target belongs to hwnd=' + $winHandle) }
        exit 0
      }
      switch ($kind) {
        'invoke' {
          $ip = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $ip.Invoke()
          Out @{ ok = $true; action = 'invoke'; window = @{ handle = $winHandle; title = $hit.window.Current.Name } }
          exit 0
        }
        'focus' {
          $el.SetFocus()
          Out @{ ok = $true; action = 'focus'; window = @{ handle = $winHandle; title = $hit.window.Current.Name } }
          exit 0
        }
        'set_value' {
          $v = [string]$p.value
          $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
          if ($vp.Current.IsReadOnly) { Out @{ ok = $false; error = 'target value is read-only' }; exit 0 }
          $vp.SetValue($v)
          Out @{ ok = $true; action = 'set_value'; value = $v; window = @{ handle = $winHandle; title = $hit.window.Current.Name } }
          exit 0
        }
        'select' {
          $sp = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
          $sp.Select()
          Out @{ ok = $true; action = 'select'; window = @{ handle = $winHandle; title = $hit.window.Current.Name } }
          exit 0
        }
        default { Out @{ ok = $false; error = ('unknown act kind: ' + $kind) }; exit 0 }
      }
    }
    'window' {
      Require-Uia
      Require-Win32
      $h = [int64]$p.handle
      if (-not [CuWin]::IsWindow([IntPtr]$h)) { Out @{ ok = $false; error = ('window not found: hwnd=' + $h) }; exit 0 }
      switch ([string]$p.kind) {
        'activate' { [void][CuWin]::SetForegroundWindow([IntPtr]$h); Out @{ ok = $true; action = 'activate'; handle = $h }; exit 0 }
        'move' {
          $r = $p.rect
          [void][CuWin]::MoveWindow([IntPtr]$h, [int]$r.x, [int]$r.y, [int]$r.w, [int]$r.h, $true)
          Out @{ ok = $true; action = 'move'; handle = $h; rect = $r }; exit 0
        }
        'close' { [void][CuWin]::PostMessage([IntPtr]$h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); Out @{ ok = $true; action = 'close'; handle = $h }; exit 0 }
        default { Out @{ ok = $false; error = ('unknown window kind: ' + [string]$p.kind) }; exit 0 }
      }
    }
    'wait' {
      Require-Uia
      $timeout = 15000
      if ($p.timeoutMs) { $timeout = [int]$p.timeoutMs }
      $deadline = (Get-Date).AddMilliseconds($timeout)
      $found = $true
      while ((Get-Date) -lt $deadline) {
        $found = $false
        if ($p.handle) {
          if ((Get-WindowElement $p.handle) -ne $null) { $found = $true }
        } elseif ($p.locator) {
          if ((Find-ElementByLocator ([string]$p.locator)) -ne $null) { $found = $true }
        } elseif ($p.titleContains) {
          foreach ($w in (Get-WindowList)) { if ($w.title -like ('*' + $p.titleContains + '*')) { $found = $true } }
        }
        if ($found) { break }
        Start-Sleep -Milliseconds 250
      }
      Out @{ ok = $true; found = $found }
      exit 0
    }
    default { Out @{ ok = $false; error = ('unknown action: ' + $action) }; exit 0 }
  }
} catch {
  Out @{ ok = $false; error = $_.Exception.Message }
  exit 0
}
