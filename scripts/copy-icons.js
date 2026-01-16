const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'src', 'nodes', 'Blumira', 'blumira.svg');
const destination = path.join(__dirname, '..', 'dist', 'nodes', 'Blumira', 'blumira.svg');

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
