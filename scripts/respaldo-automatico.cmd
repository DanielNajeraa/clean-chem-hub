@echo off
rem Ejecutado por el Programador de tareas de Windows (ver programar-respaldo.ps1).
rem Lee las credenciales de .env.backup.local y deja el log en Documents\Respaldos-BeeClean\respaldos.log
cd /d "%~dp0.."
if not exist "%USERPROFILE%\Documents\Respaldos-BeeClean" mkdir "%USERPROFILE%\Documents\Respaldos-BeeClean"
echo ===== %date% %time% ===== >> "%USERPROFILE%\Documents\Respaldos-BeeClean\respaldos.log"
node scripts\backup-prod.mjs >> "%USERPROFILE%\Documents\Respaldos-BeeClean\respaldos.log" 2>&1
