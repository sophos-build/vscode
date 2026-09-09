<!-- Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT License. See License.txt in the project root. -->

# Immersive Code OSS on Meta Horizon

This experimental web-workbench contribution presents real VS Code text models in three floating WebXR panels: open files, code, and a coding keyboard. It runs in Meta Horizon Browser on a hand-tracking Quest headset. It is not a native Android application or a Horizon Worlds experience.

## Run

1. Build this checkout using the repository's normal development setup. If dependencies and other build outputs already exist, `npm run transpile-client` updates the web workbench.
2. Start the source web server with `node scripts/code-web.js --host 127.0.0.1 --port 8080 --browserType none`. For a local workspace, pass its folder path as the first argument. This development server provides access to that workspace; keep it on a trusted connection.
3. Expose the server to the headset through an authenticated HTTPS endpoint with a certificate trusted by the headset. WebXR requires a secure context; plain HTTP to a computer's LAN address is insufficient. Alternatively, with Quest developer mode and USB debugging already enabled, `adb reverse tcp:8080 tcp:8080` permits using `http://localhost:8080` in the headset browser.
4. Open the hosted workbench in Horizon Browser, open the files you want to edit, and run **Horizon: Open Immersive Editor** from the Command Palette.
5. Enable hand tracking in Quest settings. Select **Enter VR with Hands** and allow the browser's VR permission. The session requires `hand-tracking`; failure leaves the pointer preview available.

The public vscode.dev deployment does not include changes from this checkout.

## Interaction

- Point either hand at a panel. A contrast reticle marks the hit position. Pinch to activate once; holding does not repeatedly type.
- Pinch a file in **Open Files** to switch editors. Previous/Next page through the open editor list.
- Pinch text to place the cursor. Enable **Select**, then pinch a second position to extend the selection; disable Select to return to cursor placement.
- Use the floating keyboard for letters, coding punctuation, Space, Enter, Tab, and Backspace. **Shift** toggles uppercase and the alternate symbol layer.
- **Page Up/Down** and **Scroll Left/Right** navigate code. Typing follows the cursor automatically.
- **Undo/Redo** use the actual model history. Read-only editors reject virtual keyboard edits.
- **Save** exits VR before invoking normal VS Code save handling, including Save As and conflict dialogs. Re-enter VR afterward. Closing the preview leaves unsaved edits in VS Code.
- **Recenter** places the panels relative to the current head pose. **Exit VR**, the headset's system exit gesture, or **Close** returns to the browser.

## Scope and validation

This is an immersive editing prototype, not a complete port of every workbench surface. It shares models and editor commands with VS Code; the visible code panel is a canvas projection, not the full Monaco DOM. Syntax colors, completion menus, diagnostics, terminals, debugging, arbitrary panel dragging, hand meshes, and an immersive workspace picker are not implemented. Use the regular workbench for these operations. Complex-script shaping and bidirectional text are not fully represented by the canvas grid. The desktop canvas preview is intended for pointer testing; keyboard and screen-reader users should use the regular workbench.

The renderer anchors panels once per session and uses per-eye projection and view matrices. It uses WebXR target rays and `select` events instead of inferring gestures from joint distances. Texture uploads occur only after a surface changes. Ending a session releases listeners, textures, shaders, buffers, and its WebGL context. No camera images or hand poses are stored or transmitted by this feature.

Run targeted tests after transpilation:

```sh
node test/unit/browser/index.js --browser chromium --runGlob '**/horizon/test/browser/*.test.js'
```

Local validation: client TypeScript check, targeted ESLint, nine Chromium tests (including a simulated stereo XR session), and a running-workbench pointer smoke test passed. A physical headset was not available for validation. The repository-wide lint command reports unrelated errors in generated extension output; it is not clean in this workspace.

Before production use, validate on physical Quest hardware: both hands, pinch accuracy, loss/recovery of hand tracking, system menu interruption, permission denial, leaving/re-entering VR, Save As cancellation, read-only files, and readability/performance in light, dark, and high-contrast themes. Desktop tests cannot establish headset comfort or hand-input quality.

References: [Meta WebXR hands](https://developers.meta.com/horizon/documentation/web/webxr-hands/), [WebXR Device API](https://immersive-web.github.io/webxr/).
