# Launch VS Code with the Error & Success Reactor extension loaded for development/testing
# Repository: https://github.com/DhakadG/ErrorScreamer
#
# Usage (from PowerShell):
#   .\launch-vscode-error-screamer.ps1
#
# If you get a script execution policy error, run:
#   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

$ExtensionDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Launching VS Code with Error & Success Reactor extension..." -ForegroundColor Cyan
Write-Host "Extension directory: $ExtensionDir" -ForegroundColor DarkGray

code --extensionDevelopmentPath="$ExtensionDir"
