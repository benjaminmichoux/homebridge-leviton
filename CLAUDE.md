# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Homebridge platform plugin for Leviton Decora Smart Wi-Fi devices. It authenticates against the Leviton cloud API, discovers devices, and exposes them to HomeKit via the Homebridge platform.

This is a maintained fork published as the scoped package `@benjaminmichoux/homebridge-leviton`. The scoped name prevents Homebridge's registry-based install/restore flow from silently overwriting this fork with upstream's unmaintained `homebridge-leviton` (which crash-loops on Node 24 — see tabrindle/homebridge-leviton#52). `PLUGIN_NAME` in `index.js` must always match the `name` in `package.json`, or Homebridge refuses to load the plugin.

## No Build Step

This is plain Node.js — there is no compile, transpile, or bundle step. Changes to `.js` files are live immediately. To test, run Homebridge itself with this plugin installed.

## Architecture

Two files make up the entire plugin:

- **`api.js`** — Stateless wrapper around the Leviton REST API (`https://my.leviton.com/api`) and SockJS WebSocket. Exports individual functions for each API call plus a `subscribe()` function that opens a persistent WebSocket connection and fires a callback on device state changes.

- **`index.js`** — Homebridge platform class `LevitonDecoraSmartPlatform`. On `didFinishLaunching` it calls `initialize()` which walks the auth chain (login → personID → accountID → residenceID → devices), then calls `Leviton.subscribe()` for real-time updates. Each device is mapped to a HomeKit service type based on its model number in `setupService()`.

### Auth chain (sequential, each step depends on the previous)

```
postPersonLogin → token + personID
getPersonResidentialPermissions(personID) → accountID
getResidentialAccounts(accountID) → residenceID + residenceObjectID
getResidenceIotSwitches(residenceID) → devices[]
  └─ fallback: getResidentialAccountsV2(residenceObjectID) → alternate residenceID
```

### Model → HomeKit service mapping (`setupService`)

| Models | Service |
|--------|---------|
| `DW4SF` | Fan (RotationSpeed) |
| `DWVAA`, `DW1KD`, `DW6HD`, `D26HD`, `D23LP`, `DW3HL` | Lightbulb (Brightness) |
| `DW15R`, `DW15A`, `DW15P` | Outlet |
| everything else | Switch |

### Real-time updates

`subscribe()` in `api.js` opens a SockJS connection. On `challenge`, it sends the auth token. On `status: ready`, it subscribes each device by `IotSwitch` model ID. Incoming `notification` messages with a `power` field invoke the `subscriptionCallback` in `index.js`, which calls `updateValue()` on the relevant HomeKit characteristic.

## Config schema

Defined in `config.schema.json`. Required fields: `email`, `password`. Optional: `loglevel` (`debug`/`info`/`warn`/`error`, default `info`), `excludedModels` (array of model strings, case-insensitive), `excludedSerials` (array of serial strings, case-insensitive).

## Dependencies

- `sockjs-client` ^1.6 — WebSocket connection to Leviton socket server

REST calls use the global `fetch` built into Node (no `node-fetch` dependency), so a fetch-capable runtime is required — Node 18+ per the `engines` field. `node-fetch` was dropped because its v2 gzip decode throws "Premature close" on Node 24.
