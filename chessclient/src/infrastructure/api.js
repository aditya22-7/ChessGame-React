export const API_URL = (
  process.env.REACT_APP_API_URL || "http://localhost:8081"
).replace(/\/$/, "");
export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export async function request(
  path,
  { method = "GET", body, signal, sessionCheck = false } = {},
) {
  let response;
  try {
    response = await fetch(API_URL + path, {
      method,
      credentials: "include",
      signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(
      "NETWORK_ERROR",
      "Unable to reach the server. Check your connection.",
    );
  }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !sessionCheck)
      window.dispatchEvent(new Event("chess:unauthenticated"));
    throw new ApiError(
      data.error?.code || "REQUEST_FAILED",
      data.error?.message || "Request failed",
      response.status,
    );
  }
  return data;
}
export async function session() {
  try {
    return await request("/session", { sessionCheck: true });
  } catch (e) {
    if (e.status === 401) return null;
    throw e;
  }
}
export const tournamentPath = (id) => "/tournaments/" + encodeURIComponent(id);
