"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createOfficeRfidSerial, normalizeComPath } = require("../src/office-rfid-serial");

function fakeSerialPort({ ports = [{ path: "COM3", manufacturer: "Silicon Labs", vendorId: "10C4", serialNumber: "private" }], onOpen = null } = {}) {
  const opened = [];
  class FakePort extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.isOpen = false;
      this.destroyed = false;
      opened.push(this);
    }

    open(callback) {
      this.isOpen = true;
      callback(null);
      if (onOpen) setImmediate(() => onOpen(this));
    }

    close(callback) {
      this.isOpen = false;
      callback(null);
    }

    destroy() {
      this.destroyed = true;
    }
  }
  FakePort.list = async () => ports;
  return { FakePort, opened };
}

test("COM reader listing exposes only sanitized COM port metadata", async () => {
  const { FakePort } = fakeSerialPort({ ports: [
    { path: "COM3", manufacturer: "Silicon Labs\nCP210x", vendorId: "10C4", serialNumber: "do-not-expose" },
    { path: "\\\\.\\COM3", manufacturer: "unsafe path" },
    { path: "COM0", manufacturer: "invalid port" },
  ] });
  const reader = createOfficeRfidSerial({ SerialPort: FakePort });
  assert.deepEqual(await reader.listPorts(), [
    { path: "COM3", manufacturer: "Silicon Labs CP210x", cp210x: true },
  ]);
  assert.equal(normalizeComPath("com3"), "COM3");
  assert.equal(normalizeComPath("COM0"), "");
  assert.equal(normalizeComPath("\\\\.\\COM3"), "");
});

test("CR100 serial capture reads the bounded hex token and opens with 9600 8-N-1 hardware flow control", async () => {
  const { FakePort, opened } = fakeSerialPort({ onOpen(port) {
    port.emit("data", Buffer.from("\x023F00", "ascii"));
    port.emit("data", Buffer.from("238493\x03", "ascii"));
  } });
  const reader = createOfficeRfidSerial({ SerialPort: FakePort, timeoutMs: 100, interByteMs: 20 });
  assert.equal(await reader.captureCardCode({ portPath: "COM3" }), "3F00238493");
  assert.deepEqual(opened[0].options, {
    path: "COM3",
    baudRate: 9600,
    dataBits: 8,
    parity: "none",
    stopBits: 1,
    rtscts: true,
    autoOpen: false,
  });
  assert.equal(opened[0].isOpen, false);
});

test("serial capture rejects unlisted ports and blocks a second simultaneous capture", async () => {
  const { FakePort } = fakeSerialPort();
  const reader = createOfficeRfidSerial({ SerialPort: FakePort, timeoutMs: 1000 });
  await assert.rejects(reader.captureCardCode({ portPath: "COM4" }), error => error.code === "RFID_SERIAL_PORT_NOT_FOUND");
  const pending = reader.captureCardCode({ portPath: "COM3" });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(reader.captureCardCode({ portPath: "COM3" }), error => error.code === "RFID_SERIAL_BUSY");
  assert.equal(reader.cancelCapture(), true);
  await assert.rejects(pending, error => error.code === "RFID_SERIAL_CANCELLED");
});

test("serial capture reports a clear timeout and never leaks raw input through errors", async () => {
  const { FakePort } = fakeSerialPort();
  const reader = createOfficeRfidSerial({ SerialPort: FakePort, timeoutMs: 15, interByteMs: 10 });
  await assert.rejects(reader.captureCardCode({ portPath: "COM3" }), error => {
    assert.equal(error.code, "RFID_SERIAL_TIMEOUT");
    assert.equal(error.message.includes("3F00238493"), false);
    return true;
  });
});

test("serial capture rejects an overlong hexadecimal token instead of accepting its suffix", async () => {
  const { FakePort } = fakeSerialPort({ onOpen(port) {
    port.emit("data", Buffer.from("12345678901234567890ABCDEF", "ascii"));
  } });
  const reader = createOfficeRfidSerial({ SerialPort: FakePort, timeoutMs: 100, interByteMs: 20 });
  await assert.rejects(reader.captureCardCode({ portPath: "COM3" }), error => error.code === "RFID_SERIAL_INVALID_DATA");
});
