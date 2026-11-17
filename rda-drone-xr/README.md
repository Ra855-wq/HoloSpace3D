<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# RDA Drone XR

Simulação espacial 3D de patrulha e rastreamento com um quadricóptero virtual, telemetria em tempo real, geofence e visualização WebXR em maquete.

View your app in AI Studio: https://ai.studio/apps/b53d06ae-aa4d-4092-a984-72c4d439921d

## Run locally

**Prerequisites:** Node.js

1. Install dependencies: `bun install` (or `npm install`)
2. Start the dev server: `bun run dev` (or `npm run dev`)
3. Open `http://127.0.0.1:3000`

The simulation does not call the Gemini API. No API key is required.

## Controls

- **Patrulha** flies the drone around the yard waypoints.
- **Rastrear** follows the selected moving target and holds a standoff distance. Click a target in the list or in the maquette.
- **Retorno** brings the drone back to the pad.
- **Perímetro armado** keeps the drone inside the geofence. Targets can still leave; the HUD marks them as outside.
- **Maquete / Seguir** switches the camera between the site overview and a chase view.
- **Entrar em XR** starts an `immersive-vr` session when the browser supports WebXR.

Keyboard: `1` patrol, `2` track, `3` return, `Space` pause, `G` arm the geofence, `C` camera.
