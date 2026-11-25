# Registra (o actualiza) una tarea de Windows que respalda produccion todos los dias.
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\programar-respaldo.ps1 [-Hora 23:00]
param([string]$Hora = "23:00")

$cmd = Join-Path $PSScriptRoot "respaldo-automatico.cmd"
$cred = Join-Path (Split-Path $PSScriptRoot -Parent) ".env.backup.local"
if (-not (Test-Path $cred)) {
  Write-Warning "Falta $cred con BACKUP_EMAIL y BACKUP_PASSWORD; sin el, el respaldo automatico fallara."
}

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$cmd`""
$trigger = New-ScheduledTaskTrigger -Daily -At $Hora
# StartWhenAvailable: si la PC estaba apagada a esa hora, corre en cuanto se encienda.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName "Respaldo BeeClean" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Respaldo diario de produccion (npm run backup)" -Force | Out-Null

Write-Host "Tarea 'Respaldo BeeClean' programada diario a las $Hora."
