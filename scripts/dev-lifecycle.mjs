// Astro runs in this process; Java is its only child. Neither service detaches.
export async function runDevelopment({ startWeb, startBridge, signals = process, log = console.error }) {
  const web = await startWeb();
  let bridge;
  try { bridge = startBridge(); } catch (error) {
    await web.stop();
    throw error;
  }

  return new Promise((resolve) => {
    let stopping = false;
    let closed = false;
    let closedResolve;
    const bridgeClosed = new Promise((done) => { closedResolve = done; });
    const stop = async (code) => {
      if (stopping) return;
      stopping = true;
      signals.removeListener('SIGINT', interrupt);
      signals.removeListener('SIGTERM', terminate);
      const deadline = setTimeout(() => { if (!closed) bridge.kill('SIGKILL'); }, 5000);
      deadline.unref();
      if (!closed) bridge.kill('SIGTERM');
      try {
        const results = await Promise.allSettled([Promise.resolve().then(() => web.stop()), bridgeClosed]);
        for (const result of results) {
          if (result.status === 'rejected') {
            log(result.reason.message);
            code = 1;
          }
        }
      } finally {
        clearTimeout(deadline);
        resolve(code);
      }
    };
    const interrupt = () => { void stop(130); };
    const terminate = () => { void stop(143); };
    signals.once('SIGINT', interrupt);
    signals.once('SIGTERM', terminate);
    bridge.once('error', (error) => {
      log(error.message);
      closed = true;
      closedResolve();
      void stop(1);
    });
    bridge.once('close', (code) => {
      closed = true;
      closedResolve();
      if (!stopping) {
        log('Bridge exited; stopping the dev server.');
        void stop(code || 1);
      }
    });
  });
}
