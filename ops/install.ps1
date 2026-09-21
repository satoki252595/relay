# Relay サーバー かんたんセットアップ (Windows)
# 使い方 (PowerShell):
#   irm https://raw.githubusercontent.com/satoki252595/relay/main/ops/install.ps1 | iex
#   .\ops\install.ps1 [-Dir "$env:USERPROFILE\relay-server"] [-Port 8787] [-NoService] [-Uninstall]
param(
  [string]$Dir = (Join-Path $env:USERPROFILE 'relay-server'),
  [int]$Port = 8787,
  [switch]$NoService,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'

if ($Uninstall) {
  Write-Host '==> タスク削除'
  schtasks /delete /tn 'RelayServer' /f 2>$null | Out-Null
  Write-Host "done (フォルダ $Dir は残しています)"
  exit 0
}

function Need($cmd) { -not (Get-Command $cmd -ErrorAction SilentlyContinue) }

# 1. node
$nodeOk = $false
if (-not (Need 'node')) {
  $major = (& node -p 'process.versions.node.split(".")[0]')
  if ([int]$major -ge 20) { $nodeOk = $true }
}
if (-not $nodeOk) {
  Write-Host '==> Node.js LTS を導入します'
  if (Need 'winget') { throw 'winget がありません。https://nodejs.org/ から Node.js 20+ を手動導入してください' }
  winget install --accept-source-agreements --accept-package-agreements OpenJS.NodeJS.LTS
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
}
if (Need 'git') {
  Write-Host '==> Git を導入します'
  winget install --accept-source-agreements --accept-package-agreements Git.Git
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
}
if (Need 'gh') { Write-Host 'memo: GitHub 連携を使う場合は winget install GitHub.cli も実行してください' }

# 2. ソース取得
if (Test-Path (Join-Path $Dir 'server\index.js')) {
  Write-Host "==> 既存ディレクトリを使用: $Dir"
} elseif ((Test-Path '.\server\index.js') -and (Test-Path '.\package.json')) {
  $Dir = (Get-Location).Path
  Write-Host "==> このリポジトリを使用: $Dir"
} else {
  Write-Host "==> clone: $Dir"
  & git clone https://github.com/satoki252595/relay.git $Dir
}
Set-Location $Dir
if (-not (Test-Path '.\package.json')) { throw "$Dir は Relay リポジトリではありません" }

# 3. 依存導入 (サーバー実行分のみ)
Write-Host '==> npm install'
& npm install --omit=dev --no-audit --no-fund

# 4. ポート設定
if ($Port -ne 8787) {
  if (-not (Test-Path '.\.env') -or -not (Select-String -Path '.\.env' -Pattern '^PORT=' -Quiet)) {
    Add-Content '.\.env' "PORT=$Port"
  }
}

# 5. 常駐化 (ログオン時タスク)
if (-not $NoService) {
  Write-Host '==> ログオン時タスク登録'
  $node = (Get-Command node).Source
  schtasks /create /tn 'RelayServer' /f /sc onlogon /rl limited `
    /tr "$node $Dir\server\index.js" /ru $env:USERNAME | Out-Null
  schtasks /run /tn 'RelayServer' | Out-Null
  Start-Sleep 3
} else {
  Write-Host '==> タスク登録なし。このまま起動します (Ctrl-C で停止)'
  Start-Job -ScriptBlock { Set-Location $using:Dir; & node server\index.js } | Out-Null
  Start-Sleep 3
}

# 6. 接続情報
$tokenFile = Join-Path $Dir 'data\.token'
if (-not (Test-Path $tokenFile)) { throw 'トークンを読めません' }
$token = (Get-Content $tokenFile -Raw).Trim()
$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp, Manual -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
if (-not $ip) { $ip = '127.0.0.1' }
$url = "http://${ip}:${Port}"
Write-Host ''
Write-Host '======== 接続情報 ========'
Write-Host "URL:    $url"
Write-Host "token:  $token"
Write-Host '=========================='
Write-Host 'iPhone アプリに URL と token を入力してください。'
Write-Host 'ファイアウォールで node の受信許可が出たら「許可」してください。'
Write-Host '外出先からは Tailscale 等の閉域経由を推奨します。'
