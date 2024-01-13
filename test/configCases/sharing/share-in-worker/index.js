import { Worker } from 'worker_threads';

function getWorkerResult(worker, n) {
	return new Promise((resolve, reject) => {
		worker.on('error', (e) => {
			reject(e);
			worker.terminate();
		});

		worker.on('message', (msg) => {
			resolve(msg);
			worker.terminate();
		});

		worker.postMessage(n);
	});
}

it("should able to get result from worker", async () => {
	const worker = new Worker(new URL('./worker.js', import.meta.url));
	const lib1 = await getWorkerResult(worker, 1);
	expect(lib1).toEqual("lib1");
	const { default: scope1 } = await getWorkerResult(worker);
	expect(typeof scope1.lib1).toBe("object");
	const lib2 = await getWorkerResult(worker, 2);
	expect(lib2).toEqual("lib2");
	const { default: scope2 } = await getWorkerResult(worker);
	expect(typeof scope2.lib2).toBe("object");
});
