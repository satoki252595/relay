// In-process event bus fan-out to SSE subscribers.
// Events: job_update, message_append, approval_request, approval_resolved,
// diff_update, thread_update, harness_status.
const subs = new Set();

export function subscribe(res) {
  subs.add(res);
  return () => subs.delete(res);
}

export function emit(type, payload = {}) {
  const frame = `event: ${type}\ndata: ${JSON.stringify({ type, at: Date.now(), ...payload })}\n\n`;
  for (const res of [...subs]) {
    try {
      res.write(frame);
    } catch {
      subs.delete(res);
    }
  }
}

export function subscriberCount() {
  return subs.size;
}
