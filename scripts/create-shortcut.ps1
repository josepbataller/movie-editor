# Creates a Desktop shortcut that launches the CURRENT build of Movie Editor
# (dist/ + dist-electron/ via the Electron runtime), so it is never out of date
# with the packaged copy in release/. Run `npm run build` after code changes.
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { throw "Electron runtime not found at $electron. Run 'npm install' first." }

$icon = Join-Path $root 'release\win-unpacked\Movie Editor.exe'
if (-not (Test-Path $icon)) { $icon = $electron }

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Movie Editor.lnk'
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = $electron
$sc.Arguments = '"' + $root + '"'
$sc.WorkingDirectory = $root
$sc.IconLocation = "$icon,0"
$sc.Description = 'Movie Editor - editor de video'
$sc.Save()
Write-Output "Shortcut created: $lnk -> $electron $root"
