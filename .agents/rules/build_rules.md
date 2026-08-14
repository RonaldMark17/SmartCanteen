# Build & Packaging Rule

Always build and update the desktop `.exe` files whenever changes or updates are made to the codebase.

## Build and Copy Steps:
1. In `smartcanteen/`:
   ```bash
   npm run electron:build
   ```
2. Copy the resulting executables to `MEALS/Client/`:
   ```bash
   copy "smartcanteen\dist-electron\MEALS.exe" "MEALS\Client\MEALS.exe"
   copy "smartcanteen\dist-electron\MEALS Setup.exe" "MEALS\Client\MEALS Setup.exe"
   ```
