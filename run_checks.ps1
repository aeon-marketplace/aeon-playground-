Set-Location "C:\Users\suruv\free-ai-playground"
Write-Host "=== TYPECHECK ==="
& .\node_modules\.bin\tsc --noEmit 2>&1 | Select-Object -Last 60
Write-Host ""
Write-Host "=== LINT ==="
& .\node_modules\.bin\eslint . 2>&1 | Select-Object -Last 40
Write-Host ""
Write-Host "=== TEST ==="
& .\node_modules\.bin\vitest run 2>&1 | Select-Object -Last 30
