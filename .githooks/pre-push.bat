@echo off
rem Windows 包装：让 git 在 Windows 上也能可靠执行 .githooks/pre-push
rem Git for Windows 自带 sh，优先用它执行真正的钩子脚本
setlocal
set HOOK=%~dp0pre-push
if exist "C:\Program Files\Git\bin\sh.exe" (
  "C:\Program Files\Git\bin\sh.exe" "%HOOK%" %*
  exit /b %errorlevel%
)
where sh >nul 2>nul
if not errorlevel 1 (
  sh "%HOOK%" %*
  exit /b %errorlevel%
)
echo   [pre-push] 找不到 sh，跳过安全检查（建议安装 Git for Windows 完整版）
exit /b 0
