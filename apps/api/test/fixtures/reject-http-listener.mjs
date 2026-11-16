import { Server } from 'node:net';

Server.prototype.listen = function () {
  process.stderr.write('UNEXPECTED_HTTP_LISTENER\n');
  throw new Error('Migration compatibility tests must never open an HTTP listener.');
};
