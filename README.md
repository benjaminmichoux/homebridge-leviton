# homebridge-leviton

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
Homebridge plugin for Leviton Decora Smart devices

## Supports

These models are tested, though any other WiFi model should work.

- DW6HD 600W Dimmer
- D26HD 600W Dimmer (2nd Gen)
- DW1KD 1000W Dimmer
- DW3HL Wi-Fi Plugin Dimmer
- D23LP Wi-Fi Plugin Dimmer (2nd Gen)
- DW15P Wi-Fi Plugin Outlet
- DW4SF Fan Speed Controller

## Requirements

- Node.js 18, 20, or 22
- Homebridge 1.8+ or 2.x

## Setup

_You must use the main "My Leviton" login credentials._

- add `homebridge-leviton` in your Homebridge Config UI X web interface
- Add to your config.json:

```json
"platforms": [
  {
    "platform": "LevitonDecoraSmart",
    "email": "your@email.com",
    "password": "supersecretpassword",
    "loglevel": "info",
    "excludedModels": ["DWP15"],
    "excludedSerials": ["1000_0023_CCE2"]
  }
]
```

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `email` | yes | — | My Leviton account email |
| `password` | yes | — | My Leviton account password |
| `loglevel` | no | `info` | `debug`, `info`, `warn`, or `error` |
| `excludedModels` | no | `[]` | Skip entire model families (e.g. fully HomeKit-native devices) |
| `excludedSerials` | no | `[]` | Skip individual devices by serial number |

## Features

- Automatically discovers devices on your My Leviton account
- On/Off, Brightness (with min/max limits), Fan speed
- Real-time state updates via WebSocket (auto-reconnects on connection drop)
- Shows serial/model/firmware in HomeKit accessory info
