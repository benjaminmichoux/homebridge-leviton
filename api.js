const SockJS = require('sockjs-client')

const baseURL = 'https://my.leviton.com/api'
const toQueryString = (params) =>
  Object.keys(params)
    .map((key) => `${key}=${params[key]}`)
    .join('&')

function getResidenceIotSwitches({ residenceID, token }) {
  return fetch(`${baseURL}/Residences/${residenceID}/iotSwitches`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: token },
  }).then((res) => res.json())
}

function getIotSwitch({ switchID, token }) {
  return fetch(`${baseURL}/IotSwitches/${switchID}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: token },
  }).then((res) => res.json())
}

function putIotSwitch({ switchID, power, brightness, token }) {
  const body = {}
  if (brightness) body.brightness = brightness
  if (power) body.power = power
  return fetch(`${baseURL}/IotSwitches/${switchID}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: token },
  }).then((res) => res.json())
}

function getPersonResidentialPermissions({ personID, token }) {
  return fetch(`${baseURL}/Person/${personID}/residentialPermissions`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: token },
  }).then((res) => res.json())
}

function getResidentialAccounts({ accountID, token }) {
  return fetch(`${baseURL}/ResidentialAccounts/${accountID}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: token },
  }).then((res) => res.json())
}

function getResidentialAccountsV2({ residenceObjectID, token }) {
  return fetch(`${baseURL}/ResidentialAccounts/${residenceObjectID}/residences`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: token },
  }).then((res) => res.json())
}

function postPersonLogin({ email, password }) {
  const query = toQueryString({ include: 'user' })
  return fetch(`${baseURL}/Person/login?${query}`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  }).then((res) => res.json())
}

function subscribe(login, devices, callback, scope, retryDelay = 5000) {
  const ws = new SockJS('https://my.leviton.com/socket')

  ws.onclose = function (ev) {
    scope.log.error(`Socket connection closed: ${JSON.stringify(ev)}`)
    const nextDelay = Math.min(retryDelay * 2, 60000)
    scope.log.info(`Reconnecting in ${retryDelay / 1000}s...`)
    setTimeout(() => subscribe(login, devices, callback, scope, nextDelay), retryDelay)
  }

  ws.onerror = function (ev) {
    scope.log.error(`Socket error: ${JSON.stringify(ev)}`)
  }

  ws.onopen = function (ev) {
    scope.log.debug(`Socket connection opened: ${JSON.stringify(ev)}`)
  }

  ws.onmessage = function (message) {
    let data
    try {
      data = JSON.parse(message.data)
    } catch (err) {
      scope.log.error(`Received bad json: ${String(message.data)}`)
      return
    }
    if (data.type === 'challenge') {
      ws.send([JSON.stringify({ token: login })])
    }
    if (data.type === 'status' && data.status === 'ready') {
      devices.forEach((element) => {
        ws.send([JSON.stringify({ type: 'subscribe', subscription: { modelName: 'IotSwitch', modelId: element.id } })])
      })
    }
    if (data.type === 'notification' && data.notification?.data?.power) {
      const payload = {
        id: data.notification.modelId,
        power: data.notification.data.power,
      }
      if (data.notification.data.brightness) payload.brightness = data.notification.data.brightness
      callback(payload)
    }
  }
}

module.exports = {
  getIotSwitch,
  getPersonResidentialPermissions,
  getResidenceIotSwitches,
  getResidentialAccounts,
  getResidentialAccountsV2,
  postPersonLogin,
  putIotSwitch,
  subscribe,
}
