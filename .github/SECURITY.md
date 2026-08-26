# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Architecture & Privacy Model

Greater Bangkok Metro Mini 3D is a **fully static, client-side Web application**:
- **No Backend / No User Database**: The app runs entirely in the user's browser.
- **Zero Tracking / Zero Cookies**: No analytical scripts, tracking pixels, or third-party ad telemetry are bundled or loaded.
- **WebAssembly Sandboxing**: Simulation calculations are executed inside a sandboxed Web Worker environment with strictly validated buffer boundaries.

## Reporting a Vulnerability

If you discover a security vulnerability or security-related issue in this project:

1. **Do not create a public GitHub issue.**
2. Report the vulnerability privately via GitHub Security Advisories or by email to `y.lamnaonan@gmail.com`.
3. Please include:
   - Description of the vulnerability and its potential impact.
   - Steps to reproduce or a minimal proof of concept.
   - Any suggested remediations or mitigations.

You will receive an acknowledgment within 48 hours, followed by updates on the timeline for remediation.
