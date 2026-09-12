/** Keep the deadline active until the response body has been consumed. */
export async function fetchWithTimeout(url, init, timeoutMs, consume) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await consume(response);
  } finally {
    clearTimeout(timer);
  }
}
