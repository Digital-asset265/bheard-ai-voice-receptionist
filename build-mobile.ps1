$ErrorActionPreference = "Stop"

# 1) esconder API routes (porque output: export não suporta)
if (Test-Path "src\app\api") {
  if (Test-Path "src\app\__api_disabled") { Remove-Item "src\app\__api_disabled" -Recurse -Force }
  Rename-Item "src\app\api" "__api_disabled"
}

# 2) usar config mobile
Copy-Item "next.config.ts" "next.config.ts.bak" -Force
Copy-Item "next.config.mobile.ts" "next.config.ts" -Force

# 3) limpar e build
if (Test-Path "out") { Remove-Item "out" -Recurse -Force }
npm run build

# 4) restaurar config original
Copy-Item "next.config.ts.bak" "next.config.ts" -Force
Remove-Item "next.config.ts.bak" -Force

# 5) restaurar API routes
if (Test-Path "src\app\__api_disabled") {
  Rename-Item "src\app\__api_disabled" "api"
}

Write-Host "✅ Mobile export gerado em /out"