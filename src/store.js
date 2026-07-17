'use strict';

const fs = require('node:fs');
const path = require('node:path');

class JsonStore {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
  }

  file(name) {
    return path.join(this.directory, name);
  }

  read(name, fallback = null) {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  write(name, value) {
    const target = this.file(name);
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporary, target);
  }

  remove(name) {
    try {
      fs.rmSync(this.file(name), { force: true });
    } catch {
      // Missing/locked preference files are non-fatal.
    }
  }
}

module.exports = { JsonStore };
