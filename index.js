let Service, Characteristic, Accessory, UUID
const Leviton = require('./api.js')
const PLUGIN_NAME = '@benjaminmichoux/homebridge-leviton'
const PLATFORM_NAME = 'LevitonDecoraSmart'
const levels = ['debug', 'info', 'warn', 'error']

class LevitonDecoraSmartPlatform {
  constructor(log, config, api) {
    this.config = config
    this.api = api
    this.accessories = []
    this.token = null

    const noop = function () {}
    const logger = (level) => (msg) =>
      levels.indexOf((config && levels.includes(config.loglevel) && config.loglevel) || 'info') <= levels.indexOf(level)
        ? log(msg)
        : noop()

    this.log = levels.reduce((a, l) => {
      a[l] = logger(l)
      return a
    }, {})

    if (!config) {
      this.log.error(`No config for ${PLUGIN_NAME} defined.`)
      return
    }

    if (!config.email || !config.password) {
      this.log.error(`email and password for ${PLUGIN_NAME} are required in config.json`)
      return
    }

    api.on('didFinishLaunching', async () => {
      this.log.debug('didFinishLaunching')
      const { devices, token } = await this.initialize(config)
      const excludedModels = (config.excludedModels || []).map((name) => name.toUpperCase())
      const excludedSerials = (config.excludedSerials || []).map((name) => name.toUpperCase())
      if (Array.isArray(devices) && devices.length > 0) {
        // Set up accessories restored from cache with the fresh token (their
        // cached token has since expired). Refresh their device data too.
        for (const accessory of this.accessories) {
          const device = devices.find((d) => d.serial === accessory.context.device.serial)
          if (device) accessory.context.device = device
          accessory.context.token = token
          await this.setupService(accessory)
        }
        // Add any newly discovered devices not already restored from cache.
        devices.forEach((device) => {
          if (!this.accessories.find((acc) => acc.context.device.serial === device.serial)) {
            if (!excludedModels.includes(device.model) && !excludedSerials.includes(device.serial)) {
              this.addAccessory(device, token)
            }
          }
        })
      } else {
        this.log.error('Unable to initialize: no devices found')
      }
    })
  }

  subscriptionCallback(payload) {
    const accessory = this.accessories.find((acc) => acc.context.device.id === payload.id)

    if (!accessory) return

    const { id, power, brightness } = payload
    this.log.debug(`Socket: ${accessory.displayName} (${id}): ${power} ${brightness ? `${brightness}%` : ''}`)

    const service =
      accessory.getService(Service.Fan) ||
      accessory.getService(Service.Switch) ||
      accessory.getService(Service.Outlet) ||
      accessory.getService(Service.Lightbulb)
    const isFan = !!accessory.getService(Service.Fan)

    if (brightness)
      service
        .getCharacteristic(isFan ? Characteristic.RotationSpeed : Characteristic.Brightness)
        .updateValue(brightness)
    service.getCharacteristic(Characteristic.On).updateValue(power === 'ON')
  }

  async initialize() {
    this.log.debug('initialize')

    try {
      var login = await Leviton.postPersonLogin({
        email: this.config['email'],
        password: this.config['password'],
      })
      var { id: token, userId: personID } = login
      this.token = token
      this.log.debug(`personID: ${personID}, hasToken: ${!!token}`)
    } catch (err) {
      this.log.error(`Failed to login to leviton: ${err.message}`)
    }
    try {
      const permissions = await Leviton.getPersonResidentialPermissions({
        personID,
        token,
      })
      var accountID = permissions[0].residentialAccountId
      this.log.debug(`accountID: ${accountID}`)
    } catch (err) {
      this.log.error(`Failed to get leviton accountID: ${err.message}`)
    }
    try {
      var { primaryResidenceId: residenceID, id: residenceObjectID } = await Leviton.getResidentialAccounts({
        accountID,
        token,
      })
      this.log.debug(`residenceID: ${residenceID}`)
    } catch (err) {
      this.log.error(`Failed to get leviton residenceID: ${err.message}`)
    }
    try {
      var devices = await Leviton.getResidenceIotSwitches({
        residenceID,
        token,
      })
      this.log.debug(`devices: ${JSON.stringify(devices)}`)
    } catch (err) {
      this.log.error(`Failed to get leviton devices: ${err.message}`)
    }

    try {
      if (!Array.isArray(devices) || devices.length < 1) {
        this.log.info('No devices found for primary residence id. Trying residence v2')

        const accountsV2Response = await Leviton.getResidentialAccountsV2({
          residenceObjectID,
          token,
        })

        if (accountsV2Response[0]) {
          residenceID = accountsV2Response[0].id
          devices = await Leviton.getResidenceIotSwitches({
            residenceID,
            token,
          })
        } else {
          throw new Error('No residenceIDs found')
        }

        if (!Array.isArray(devices) || devices.length < 1) {
          throw new Error(
            `No devices found for residenceID: ${residenceID} or residenceIDV2 method: ${residenceObjectID}`
          )
        } else {
          Leviton.subscribe(login, devices, this.subscriptionCallback.bind(this), this)
        }
      } else {
        Leviton.subscribe(login, devices, this.subscriptionCallback.bind(this), this)
      }
    } catch (err) {
      this.log.error(`Error subscribing devices to websocket updates: ${err.message}`)
    }

    return { devices, token }
  }

  async addAccessory(device, token) {
    this.log.info(`addAccessory ${device.name}`)

    const uuid = UUID.generate(device.serial)
    const accessory = new this.api.platformAccessory(device.name, uuid)

    accessory.context.device = device
    accessory.context.token = token

    accessory
      .getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Name, device.name)
      .setCharacteristic(Characteristic.SerialNumber, device.serial)
      .setCharacteristic(Characteristic.Manufacturer, device.manufacturer)
      .setCharacteristic(Characteristic.Model, device.model)
      .setCharacteristic(Characteristic.FirmwareRevision, device.version)

    await this.setupService(accessory)
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])

    this.accessories.push(accessory)
    this.log.debug(`Finished adding accessory ${device.name}`)
  }

  async configureAccessory(accessory) {
    this.log.debug(`configureAccessory: ${accessory.displayName}`)
    // Defer service setup until didFinishLaunching, once we have a fresh token.
    this.accessories.push(accessory)
  }

  async getStatus(device) {
    this.log.debug(`getStatus: ${device.name}`)
    return Leviton.getIotSwitch({ switchID: device.id, token: this.token })
  }

  async setupService(accessory) {
    this.log.debug(`setupService: ${accessory.displayName}`)

    const device = accessory.context.device
    this.log.debug(`Device Model: ${device.model}`)

    switch (device.model) {
      case 'DW4SF':
        await this.setupFanService(accessory)
        break
      case 'DWVAA':
      case 'DW1KD':
      case 'DW6HD':
      case 'D26HD':
      case 'D23LP':
      case 'DW3HL':
        await this.setupLightbulbService(accessory)
        break
      case 'DW15R':
      case 'DW15A':
      case 'DW15P':
        await this.setupOutletService(accessory)
        break
      default:
        await this.setupSwitchService(accessory)
        break
    }
  }

  async setupSwitchService(accessory) {
    this.log.debug(`Setting up device as Switch: ${accessory.displayName}`)

    const device = accessory.context.device
    const status = await this.getStatus(device)

    const service = accessory.getService(Service.Switch) || accessory.addService(Service.Switch, device.name)

    service
      .getCharacteristic(Characteristic.On)
      .onGet(async () => {
        const res = await Leviton.getIotSwitch({ switchID: device.id, token: this.token })
        this.log.debug(`onGetPower: ${device.name} ${res.power}`)
        return res.power === 'ON'
      })
      .onSet(async (value) => {
        await Leviton.putIotSwitch({ switchID: device.id, power: value ? 'ON' : 'OFF', token: this.token })
        this.log.info(`onSetPower: ${device.name} ${value ? 'ON' : 'OFF'}`)
      })
      .updateValue(status.power === 'ON')
  }

  async setupOutletService(accessory) {
    this.log.debug(`Setting up device as Outlet: ${accessory.displayName}`)

    const device = accessory.context.device
    const status = await this.getStatus(device)

    const service = accessory.getService(Service.Outlet) || accessory.addService(Service.Outlet, device.name)

    service
      .getCharacteristic(Characteristic.On)
      .onGet(async () => {
        const res = await Leviton.getIotSwitch({ switchID: device.id, token: this.token })
        this.log.debug(`onGetPower: ${device.name} ${res.power}`)
        return res.power === 'ON'
      })
      .onSet(async (value) => {
        await Leviton.putIotSwitch({ switchID: device.id, power: value ? 'ON' : 'OFF', token: this.token })
        this.log.info(`onSetPower: ${device.name} ${value ? 'ON' : 'OFF'}`)
      })
      .updateValue(status.power === 'ON')
  }

  async setupLightbulbService(accessory) {
    this.log.debug(`Setting up device as Lightbulb: ${accessory.displayName}`)

    const device = accessory.context.device
    const status = await this.getStatus(device)

    const service = accessory.getService(Service.Lightbulb) || accessory.addService(Service.Lightbulb, device.name)

    service
      .getCharacteristic(Characteristic.On)
      .onGet(async () => {
        const res = await Leviton.getIotSwitch({ switchID: device.id, token: this.token })
        this.log.debug(`onGetPower: ${device.name} ${res.power}`)
        return res.power === 'ON'
      })
      .onSet(async (value) => {
        await Leviton.putIotSwitch({ switchID: device.id, power: value ? 'ON' : 'OFF', token: this.token })
        this.log.info(`onSetPower: ${device.name} ${value ? 'ON' : 'OFF'}`)
      })
      .updateValue(status.power === 'ON')

    service
      .getCharacteristic(Characteristic.Brightness)
      .onGet(async () => {
        const res = await Leviton.getIotSwitch({ switchID: device.id, token: this.token })
        this.log.debug(`onGetBrightness: ${device.name} @ ${res.brightness}%`)
        return res.brightness
      })
      .onSet(async (brightness) => {
        await Leviton.putIotSwitch({ switchID: device.id, brightness, token: this.token })
        this.log.info(`onSetBrightness: ${device.name} @ ${brightness}%`)
      })
      .setProps({ minValue: status.minLevel, maxValue: status.maxLevel, minStep: 1 })
      .updateValue(status.brightness)
  }

  async setupFanService(accessory) {
    this.log.debug(`Setting up device as Fan: ${accessory.displayName}`)

    const device = accessory.context.device
    const status = await this.getStatus(device)

    const service = accessory.getService(Service.Fan) || accessory.addService(Service.Fan, device.name)

    service
      .getCharacteristic(Characteristic.On)
      .onGet(async () => {
        const res = await Leviton.getIotSwitch({ switchID: device.id, token: this.token })
        this.log.debug(`onGetPower: ${device.name} ${res.power}`)
        return res.power === 'ON'
      })
      .onSet(async (value) => {
        await Leviton.putIotSwitch({ switchID: device.id, power: value ? 'ON' : 'OFF', token: this.token })
        this.log.info(`onSetPower: ${device.name} ${value ? 'ON' : 'OFF'}`)
      })
      .updateValue(status.power === 'ON')

    service
      .getCharacteristic(Characteristic.RotationSpeed)
      .onGet(async () => {
        const res = await Leviton.getIotSwitch({ switchID: device.id, token: this.token })
        this.log.debug(`onGetRotationSpeed: ${device.name} @ ${res.brightness}%`)
        return res.brightness
      })
      .onSet(async (brightness) => {
        await Leviton.putIotSwitch({ switchID: device.id, brightness, token: this.token })
        this.log.info(`onSetRotationSpeed: ${device.name} @ ${brightness}%`)
      })
      .setProps({ minValue: 0, maxValue: status.maxLevel, minStep: status.minLevel })
      .updateValue(status.brightness)
  }

  removeAccessories() {
    this.log.info('Removing all accessories')
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories)
    this.accessories.splice(0, this.accessories.length)
  }
}

module.exports = function (homebridge) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  Accessory = homebridge.hap.Accessory
  UUID = homebridge.hap.uuid
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, LevitonDecoraSmartPlatform, true)
}
