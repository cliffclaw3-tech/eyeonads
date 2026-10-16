param(
  [Parameter(Mandatory=$true)][string]$Python,
  [Parameter(Mandatory=$true)][string]$Config
)
$ErrorActionPreference='Stop'
$workerScript=Join-Path $PSScriptRoot 'poll_worker.py'
$resolvedConfig=(Resolve-Path -LiteralPath $Config).Path
$resolvedPython=(Resolve-Path -LiteralPath $Python).Path
if ($resolvedConfig.StartsWith($PSScriptRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Keep worker credentials outside source.' }
# Run only as the current interactive operator, without elevation or stored
# Windows password. Codex sign-in and the scoped beta token stay on this PC.
$workerAction=New-ScheduledTaskAction -Execute $resolvedPython -Argument ('"'+$workerScript+'" --config "'+$resolvedConfig+'"') -WorkingDirectory $PSScriptRoot
$workerTrigger=New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$workerPrincipal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$workerSettings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'EyeOnAds Beta Buddy Worker' -Action $workerAction -Trigger $workerTrigger -Principal $workerPrincipal -Settings $workerSettings -Description 'Scoped isolated beta repairs only; no customer production access.' -Force | Out-Null
Start-ScheduledTask -TaskName 'EyeOnAds Beta Buddy Worker'
Write-Output 'Beta worker scheduled for this signed-in operator. This computer must remain awake and connected.'
