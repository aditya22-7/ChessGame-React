import { io } from "socket.io-client";
import { API_URL, ApiError } from "./api";
export function createRealtime() {
  const socket = io(API_URL, {
    withCredentials: true,
    autoConnect: false,
    reconnection: true,
  });
  function send(event, payload) {
    if (!socket.connected)
      return Promise.reject(
        new ApiError("OFFLINE", "Reconnect before performing this action."),
      );
    return new Promise((resolve, reject) =>
      socket.timeout(7000).emit(event, payload, (timeout, response) => {
        if (timeout)
          return reject(
            new ApiError(
              "ACK_TIMEOUT",
              "The server response was not received. The action may have completed.",
            ),
          );
        if (!response?.ok) {
          const e = response?.error || {};
          if (e.code === "UNAUTHENTICATED")
            window.dispatchEvent(new Event("chess:unauthenticated"));
          return reject(
            new ApiError(
              e.code || "INVALID_RESPONSE",
              e.message || "Unexpected server response",
            ),
          );
        }
        resolve(response.data);
      }),
    );
  }
  return { socket, send };
}
