param(
  [string[]]$Cases=@('a01,A1,6,6,normal','b01,BN1,6,6,normal','b02,BN1,6,6,normal','a02,A1,6,6,normal','a03,A1,6,6,normal','b03,BN1,6,6,normal'),
  [int]$Port=3148,
  [string]$Output='output/ocr-numeric-training/runtime-20261011',
  [double]$MaxWorkingGiB=6,
  [double]$MinFreeGiB=3
)
$ErrorActionPreference='Stop'
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$outputRoot=[IO.Path]::GetFullPath((Join-Path $appRoot $Output))
$allowedOutput=[IO.Path]::GetFullPath((Join-Path $appRoot 'output'))+[IO.Path]::DirectorySeparatorChar
if(!$outputRoot.StartsWith($allowedOutput,[StringComparison]::OrdinalIgnoreCase)){throw 'Output must be ignored'}
[void][IO.Directory]::CreateDirectory($outputRoot)
$cacheRoot=(& npm.cmd config get cache).Trim()
$cliPackage=Get-ChildItem -LiteralPath (Join-Path $cacheRoot '_npx') -Filter package.json -Recurse -ErrorAction SilentlyContinue |
  Where-Object {$_.FullName -match '[\\/]@playwright[\\/]cli[\\/]package.json$'} | Select-Object -First 1
if(!$cliPackage){throw 'Cache @playwright/cli via npx before running'}
$cliInfo=Get-Content -LiteralPath $cliPackage.FullName -Raw | ConvertFrom-Json
$cliEntry=Join-Path $cliPackage.DirectoryName $cliInfo.bin.'playwright-cli'
$nodeExecutable=(Get-Command node).Source
foreach($definition in $Cases){
  $parts=$definition.Split(',');if($parts.Count -ne 5){throw 'Expected id,model,batch,rounds,mode'}
  $trialId,$model,$batch,$rounds,$mode=$parts
  if($trialId -notmatch '^[a-z0-9-]+$' -or $model -notin @('A1','BN1') -or $batch -notin @('1','6') -or $mode -notin @('normal','dual','cancel-init','cancel-predict')){throw 'Invalid trial'}
  if((Test-Path -LiteralPath (Join-Path $outputRoot "resources-$trialId.json")) -or (Test-Path -LiteralPath (Join-Path $outputRoot "runtime-$trialId.json"))){throw 'Do not overwrite an existing trial'}
  $sessionName="numeric-runtime-$trialId";$endpoint="http://127.0.0.1:$Port/api/runtime"
  $launch=& $nodeExecutable $cliEntry "-s=$sessionName" open "http://127.0.0.1:$Port/runtime.html?id=$trialId&model=$model&batch=$batch&rounds=$rounds&mode=$mode" 2>&1
  $rootMatch=[regex]::Match(($launch -join ' '),'opened with pid (\d+)')
  if(!$rootMatch.Success){$launch | Out-String | Write-Output;throw 'No owned browser PID'}
  $browserRootId=[int]$rootMatch.Groups[1].Value
  $samples=[Collections.Generic.List[object]]::new();$abortReason=$null;$runtimeState=$null
  $elapsed=[Diagnostics.Stopwatch]::StartNew();$started=$false;$readySamples=0;$lastPrint=-15
  try{
    do{
      $runtimeState=Invoke-RestMethod "$endpoint/status?id=$trialId" -TimeoutSec 5
      $all=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
      $family=[Collections.Generic.HashSet[int]]::new();[void]$family.Add($browserRootId)
      do{$changed=$false;foreach($item in $all){if($family.Contains([int]$item.ParentProcessId) -and $family.Add([int]$item.ProcessId)){$changed=$true}}}while($changed)
      $working=0L;$private=0L;$processCount=0
      foreach($proc in @(Get-Process -Id @($family) -ErrorAction SilentlyContinue)){$working+=$proc.WorkingSet64;$private+=$proc.PrivateMemorySize64;$processCount++}
      $available=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory*1KB
      $samples.Add([pscustomobject]@{seconds=$elapsed.Elapsed.TotalSeconds;phase=$runtimeState.phase;appElapsedMs=$runtimeState.elapsedMs;
        workingBytes=$working;privateBytes=$private;processCount=$processCount;freeBytes=$available;liveWorkers=$runtimeState.liveWorkers})
      if(!$started -and $runtimeState.phase -eq 'ready' -and ++$readySamples -ge 3){
        Invoke-RestMethod "$endpoint/start?id=$trialId" -TimeoutSec 5 | Out-Null;$started=$true
      }
      if($working -gt $MaxWorkingGiB*1GB -or $available -lt $MinFreeGiB*1GB -or $elapsed.Elapsed.TotalSeconds -gt 300){throw 'Runtime resource/time limit'}
      if($elapsed.Elapsed.TotalSeconds-$lastPrint -ge 15){
        Write-Output ("PROGRESS {0} {1}, {2:N1}s, WS {3:N0}MiB, private {4:N0}MiB" -f $trialId,$runtimeState.phase,$elapsed.Elapsed.TotalSeconds,($working/1MB),($private/1MB));$lastPrint=$elapsed.Elapsed.TotalSeconds
      }
      if($runtimeState.phase -eq 'failed'){throw $runtimeState.error}
      if($runtimeState.phase -eq 'complete'){break}
      Start-Sleep -Milliseconds 500
    }while($true)
    Write-Output "DONE $trialId workers=$($runtimeState.liveWorkers) rounds=$($runtimeState.outputs.Count)"
  }catch{$abortReason=[string]$_;throw}
  finally{
    [pscustomobject]@{id=$trialId;definition=$definition;browserRootId=$browserRootId;cliVersion=$cliInfo.version;
      abortReason=$abortReason;elapsedSeconds=$elapsed.Elapsed.TotalSeconds;samples=$samples} |
      ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputRoot "resources-$trialId.json") -Encoding utf8
    & $nodeExecutable $cliEntry "-s=$sessionName" close | Out-Null
  }
}
