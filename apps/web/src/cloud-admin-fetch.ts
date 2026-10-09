/** Notify the admin when its cookie outlives the server's OAuth session. */
export async function adminFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401) {
    const detail = await response.clone().json().catch(() => null);
    if (detail?.error === "session-expired")
      window.dispatchEvent(new CustomEvent("cloud-session-expired", { detail: detail.message }));
  }
  return response;
}
