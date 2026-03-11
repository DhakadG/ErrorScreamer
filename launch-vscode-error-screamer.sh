#!/bin/bash
# Launch VS Code with the Error & Success Reactor extension loaded for development/testing
# Repository: https://github.com/DhakadG/ErrorScreamer

EXTENSION_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Launching VS Code with Error & Success Reactor extension..."
echo "Extension directory: $EXTENSION_DIR"

code --extensionDevelopmentPath="$EXTENSION_DIR"
