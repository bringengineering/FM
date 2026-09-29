"use strict";

const OfficeRfidCore = require("./office-rfid-core");

const COM_PATH = /^COM([1-9]\d{0,2})$/i;
const MAX_PORTS = 64;
const MAX_INPUT_BYTES = 512;

function serialError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeComPath(value) {
  const path = typeof value === "string" ? value.trim().toUpperCase() : "";
  return COM_PATH.test(path) ? path : "";
}

function normalizePortInfo(port) {
  if (!port || typeof port !== "object") return null;
  const path = normalizeComPath(port.path);
  if (!path) return null;
  const manufacturer = typeof port.manufacturer === "string"
    ? port.manufacturer.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
    : "";
  const vendorId = typeof port.vendorId === "string" ? port.vendorId.trim().toLowerCase() : "";
  return Object.freeze({
    path,
    manufacturer,
    cp210x: vendorId === "10c4" || /silicon labs|cp210/i.test(manufacturer),
  });
}

function createOfficeRfidSerial({ SerialPort, timeoutMs = 15000, interByteMs = 220 } = {}) {
  let activeCapture = null;

  async function listPorts() {
    if (!SerialPort || typeof SerialPort.list !== "function") {
      throw serialError("RFID_SERIAL_UNAVAILABLE");
    }
    try {
      const ports = await SerialPort.list();
      return Object.freeze((Array.isArray(ports) ? ports : [])
        .map(normalizePortInfo)
        .filter(Boolean)
        .slice(0, MAX_PORTS));
    } catch (_error) {
      throw serialError("RFID_SERIAL_UNAVAILABLE");
    }
  }

  async function captureCardCode(input) {
    if (activeCapture) throw serialError("RFID_SERIAL_BUSY");
    if (!SerialPort || typeof SerialPort.list !== "function") {
      throw serialError("RFID_SERIAL_UNAVAILABLE");
    }
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const portPath = normalizeComPath(source.portPath);
    if (!portPath || Object.keys(source).some(key => key !== "portPath")) {
      throw serialError("RFID_SERIAL_PORT_INVALID");
    }

    const capture = { cancelRequested: false, cancel: null };
    activeCapture = capture;
    try {
      const ports = await listPorts();
      if (!ports.some(port => port.path === portPath)) throw serialError("RFID_SERIAL_PORT_NOT_FOUND");
      if (capture.cancelRequested) throw serialError("RFID_SERIAL_CANCELLED");
      if (typeof SerialPort !== "function") throw serialError("RFID_SERIAL_UNAVAILABLE");
      return await readOneCard({ SerialPort, portPath, timeoutMs, interByteMs, capture });
    } finally {
      if (activeCapture === capture) activeCapture = null;
    }
  }

  function cancelCapture() {
    if (!activeCapture) return false;
    activeCapture.cancelRequested = true;
    if (activeCapture.cancel) activeCapture.cancel();
    return true;
  }

  return Object.freeze({ listPorts, captureCardCode, cancelCapture });
}

function readOneCard({ SerialPort, portPath, timeoutMs, interByteMs, capture }) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = new SerialPort({
        path: portPath,
        baudRate: 9600,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        rtscts: true,
        autoOpen: false,
      });
    } catch (_error) {
      reject(serialError("RFID_SERIAL_OPEN_FAILED"));
      return;
    }

    let settled = false;
    let inputBytes = 0;
    let token = "";
    let deadline = null;
    let idleTimer = null;

    const clearTimers = () => {
      clearTimeout(deadline);
      clearTimeout(idleTimer);
      deadline = null;
      idleTimer = null;
    };
    const closePort = () => new Promise(done => {
      if (!port) return done();
      try {
        if (port.isOpen && typeof port.close === "function") {
          port.close(() => done());
          return;
        }
        if (!port.destroyed && typeof port.destroy === "function") port.destroy();
      } catch (_error) {}
      done();
    });
    const finish = (error, cardCode = "") => {
      if (settled) return;
      settled = true;
      clearTimers();
      capture.cancel = null;
      token = "";
      void closePort().then(() => {
        if (error) reject(error);
        else resolve(cardCode);
      });
    };
    const flushToken = () => {
      clearTimeout(idleTimer);
      idleTimer = null;
      const cardCode = OfficeRfidCore.normalizeCardCode(token);
      token = "";
      if (cardCode) finish(null, cardCode);
    };
    const onData = chunk => {
      if (settled || !Buffer.isBuffer(chunk)) return;
      inputBytes += chunk.length;
      if (inputBytes > MAX_INPUT_BYTES) {
        finish(serialError("RFID_SERIAL_INVALID_DATA"));
        return;
      }
      for (const byte of chunk) {
        const character = String.fromCharCode(byte);
        if (/^[0-9A-F]$/i.test(character)) {
          if (token.length >= 20) {
            finish(serialError("RFID_SERIAL_INVALID_DATA"));
            return;
          }
          token += character;
          clearTimeout(idleTimer);
          idleTimer = setTimeout(flushToken, interByteMs);
        } else {
          flushToken();
          if (settled) return;
        }
      }
    };

    capture.cancel = () => finish(serialError("RFID_SERIAL_CANCELLED"));
    if (capture.cancelRequested) {
      capture.cancel();
      return;
    }
    deadline = setTimeout(() => finish(serialError("RFID_SERIAL_TIMEOUT")), timeoutMs);
    port.on("data", onData);
    port.on("error", error => {
      const code = String(error && error.code || "");
      finish(serialError(code === "EBUSY" || code === "EACCES" ? "RFID_SERIAL_PORT_BUSY" : "RFID_SERIAL_OPEN_FAILED"));
    });
    try {
      port.open(error => {
        if (error) {
          const code = String(error.code || "");
          finish(serialError(code === "EBUSY" || code === "EACCES" ? "RFID_SERIAL_PORT_BUSY" : "RFID_SERIAL_OPEN_FAILED"));
        }
      });
    } catch (_error) {
      finish(serialError("RFID_SERIAL_OPEN_FAILED"));
    }
  });
}

module.exports = Object.freeze({
  normalizeComPath,
  normalizePortInfo,
  createOfficeRfidSerial,
});
