import { parentPort } from 'worker_threads';
import lib1 from 'lib1';

parentPort.on('message', (n) => {
  switch (n) {
    case 1:
      parentPort.postMessage(lib1);
      break;
    case 2:
      import("lib2").then(({ default: lib2 }) => parentPort.postMessage(lib2))
      break;
    default:
      parentPort.postMessage(__webpack_share_scopes__)
      break;
  }
});
