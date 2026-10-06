param(
  [string[]]$Trials = @('3x6','1x6','2x6'),
  [string]$Prefix = 'a',
  [ValidateRange(1,100)][int]$Count = 19,
  [ValidateRange(1,3)][int]$Rounds = 1,
  [ValidateRange(0,600000)][int]$CancelMs = 0,
  [ValidateSet('parallel','serial')][string]$Init = 'parallel',
  [int]$Port = 3007,
  [string]$Output = 'output/playwright/ocr-memory-20261007',
  [string]$CliPackageRoot = '',
  [double]$MaxWorkingGiB = 6,
  [double]$MinFreeGiB = 3
)
$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$outputRoot = [IO.Path]::GetFullPath((Join-Path $appRoot $Output))
$allowedOutput = [IO.Path]::GetFullPath((Join-Path $appRoot 'output')) + [IO.Path]::DirectorySeparatorChar
if (!$outputRoot.StartsWith($allowedOutput, [StringComparison]::OrdinalIgnoreCase)) { throw 'Use ignored output inside the app' }
[void][IO.Directory]::CreateDirectory($outputRoot)
if (!$CliPackageRoot) {
  $cacheRoot = (& npm.cmd config get cache).Trim()
  $found = Get-ChildItem -LiteralPath (Join-Path $cacheRoot '_npx') -Filter package.json -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '[\\/]@playwright[\\/]cli[\\/]package.json$' } | Select-Object -First 1
  if (!$found) { throw 'Install/cache @playwright/cli using npx before running this experiment' }
  $CliPackageRoot = $found.DirectoryName
}
$packageInfo = Get-Content -LiteralPath (Join-Path $CliPackageRoot 'package.json') -Raw | ConvertFrom-Json
$cliEntry = Join-Path $CliPackageRoot $packageInfo.bin.'playwright-cli'
$nodeExecutable = (Get-Command node).Source
$logicalCount = (Get-CimInstance Win32_Processor | Measure-Object NumberOfLogicalProcessors -Sum).Sum
foreach ($trial in $Trials) {
  if ($trial -notmatch '^([1-3])x([1236])$') { throw "Invalid trial $trial" }
  $concurrency = [int]$Matches[1]; $batch = [int]$Matches[2]
  $trialId = "$Prefix-$trial-$Count-r$Rounds"
  if ($CancelMs -gt 0) { $trialId += "-cancel$CancelMs" }
  if ($Init -eq 'serial') { $trialId += '-initserial' }
  if ($trialId -notmatch '^[a-z0-9-]+$' -or (Test-Path -LiteralPath (Join-Path $outputRoot "resources-$trialId.json"))) { throw 'Use a unique lowercase trial prefix' }
  $sessionName = "ocr-memory-$trialId"
  $endpoint = "http://127.0.0.1:$Port/api"
  $launchOutput = & $nodeExecutable $cliEntry "-s=$sessionName" open "http://127.0.0.1:$Port/?id=$trialId&n=$concurrency&batch=$batch&count=$Count&rounds=$Rounds&cancelMs=$CancelMs&init=$Init" 2>&1
  $match = [regex]::Match(($launchOutput -join ' '), 'opened with pid (\d+)')
  if (!$match.Success) { $launchOutput | Out-String | Write-Output; throw 'Browser process not found' }
  $browserRootId = [int]$match.Groups[1].Value
  $samples = [System.Collections.Generic.List[object]]::new(); $abortReason = $null; $startSent = $false
  $cpuFirst = @{}; $cpuLast = @{}; $elapsed = [Diagnostics.Stopwatch]::StartNew(); $lastPrint = -30
  try {
    $readyDeadline = (Get-Date).AddMinutes(3)
    do {
      Start-Sleep -Milliseconds 500
      $state = Invoke-RestMethod "$endpoint/status?id=$trialId" -TimeoutSec 5
      if ($state.phase -eq 'failed') { throw $state.error }
      if ((Get-Date) -gt $readyDeadline) { throw 'Preload timeout' }
    } while ($state.phase -ne 'ready')
    $capacity = $state.capacity; $readySamples = 0
    Write-Output "START $trialId"
    do {
      $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
      $family = [Collections.Generic.HashSet[int]]::new(); [void]$family.Add($browserRootId)
      do { $changed = $false; foreach ($item in $all) { if ($family.Contains([int]$item.ParentProcessId) -and $family.Add([int]$item.ProcessId)) { $changed = $true } } } while ($changed)
      $working = 0L; $private = 0L; $processCount = 0
      foreach ($proc in @(Get-Process -Id @($family) -ErrorAction SilentlyContinue)) {
        $working += $proc.WorkingSet64; $private += $proc.PrivateMemorySize64; $processCount++
        if (!$cpuFirst.ContainsKey($proc.Id)) { $cpuFirst[$proc.Id] = $proc.CPU }; $cpuLast[$proc.Id] = $proc.CPU
      }
      $available = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory * 1KB
      $samples.Add([pscustomobject]@{seconds=$elapsed.Elapsed.TotalSeconds;appElapsedMs=$state.elapsedMs;phase=$state.phase;completed=$state.completed;processCount=$processCount;workingBytes=$working;privateBytes=$private;freeBytes=$available;liveEngines=$state.liveEngines;mainThreadJsHeap=$state.mainThreadJsHeap})
      if (!$startSent -and ++$readySamples -ge 2) {
        Invoke-RestMethod "$endpoint/start?id=$trialId" -TimeoutSec 5 | Out-Null; $startSent=$true
      }
      if (($available -lt ($MinFreeGiB * 1GB) -or $working -gt ($MaxWorkingGiB * 1GB) -or $elapsed.Elapsed.TotalSeconds -gt 600) -and !$abortReason) {
        $abortReason = if ($available -lt ($MinFreeGiB * 1GB)) {'minimum free system RAM'} elseif ($working -gt ($MaxWorkingGiB * 1GB)) {'maximum browser working set'} else {'timeout'}
        Invoke-RestMethod "$endpoint/cancel?id=$trialId" -TimeoutSec 5 | Out-Null
        Write-Output "CANCEL $trialId : $abortReason"
      }
      if ($elapsed.Elapsed.TotalSeconds -gt 660) { throw 'Cancellation did not settle within hard timeout' }
      $state = Invoke-RestMethod "$endpoint/status?id=$trialId" -TimeoutSec 5
      if ($elapsed.Elapsed.TotalSeconds - $lastPrint -ge 30) {
        Write-Output ("PROGRESS {0} {1}/{2}, {3:N0}s, WS {4:N0}MiB, private {5:N0}MiB" -f $trialId,$state.completed,($Count*$Rounds),$elapsed.Elapsed.TotalSeconds,($working/1MB),($private/1MB)); $lastPrint=$elapsed.Elapsed.TotalSeconds
      }
      if ($state.phase -eq 'failed') { throw $state.error }
      if ($state.phase -ne 'complete') { Start-Sleep -Milliseconds 500 }
    } while ($state.phase -ne 'complete')
    Write-Output ("DONE {0}: {1:N2}s, completed={2}, errors={3}, liveEngines={4}" -f $trialId,($state.elapsedMs/1000),$state.completed,$state.errors,$state.liveEngines)
  } finally {
    $cpuSeconds=0.0; foreach($procId in $cpuLast.Keys) { $cpuSeconds += [Math]::Max(0,$cpuLast[$procId]-$cpuFirst[$procId]) }
    [pscustomobject]@{trial=$trialId;capacity=$capacity;logicalCount=$logicalCount;abortReason=$abortReason;elapsedSeconds=$elapsed.Elapsed.TotalSeconds;cpuSeconds=$cpuSeconds;maxWorkingGiB=$MaxWorkingGiB;minFreeGiB=$MinFreeGiB;samples=$samples} |
      ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputRoot "resources-$trialId.json") -Encoding utf8
    & $nodeExecutable $cliEntry "-s=$sessionName" close | Out-Null
  }
}
