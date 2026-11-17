import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RuntimeProvider, { useRuntime } from "./RuntimeProvider";
import { session, ApiError } from "../infrastructure/api";
import { createRealtime } from "../infrastructure/realtime";
jest.mock("../infrastructure/api", () => {
  const actual = jest.requireActual("../infrastructure/api");
  return { ...actual, session: jest.fn() };
});
jest.mock("../infrastructure/realtime", () => ({ createRealtime: jest.fn() }));
function Harness() {
  const r = useRuntime();
  return (
    <>
      <span>{r.connected ? "connected" : "offline"}</span>
      <span>{r.pending ? "unresolved" : "resolved"}</span>
      <span>{r.joined && !r.busy ? "ready" : "not ready"}</span>
      <span>sequence {r.snapshot?.moveSequence ?? 0}</span>
      <button
        onClick={() =>
          r.join({ tournamentId: "t", matchId: "m" }).catch(() => {})
        }
      >
        join
      </button>
      <button
        onClick={() =>
          r
            .command({
              type: "MOVE",
              from: { row: 1, col: 4 },
              to: { row: 3, col: 4 },
            })
            .catch(() => {})
        }
      >
        move
      </button>
      <button onClick={() => r.retryCommand().catch(() => {})}>retry</button>
    </>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
});
test("unknown acknowledgement retains command identity and retry resolves without duplicating a move", async () => {
  session.mockResolvedValue({ playerId: "p", name: "Player" });
  const handlers = {},
    socket = {
      connected: false,
      on: jest.fn(function (event, fn) {
        handlers[event] = fn;
        return this;
      }),
      off: jest.fn(function () {
        return this;
      }),
      connect: jest.fn(function () {
        this.connected = true;
        handlers.connect?.();
      }),
      disconnect: jest.fn(function () {
        this.connected = false;
      }),
    };
  let state = {
    tournamentId: "t",
    matchId: "m",
    revision: 1,
    status: "IN_PROGRESS",
    side: "white",
    turn: "white",
    moveSequence: 0,
    serverNow: Date.now(),
    deadlineAt: Date.now() + 60000,
    result: null,
  };
  const commands = [];
  const send = jest.fn(async (event, payload) => {
    if (event === "game:command") {
      commands.push(payload.command);
      if (commands.length === 1) throw new ApiError("ACK_TIMEOUT", "timeout");
      state = { ...state, revision: 2, moveSequence: 1 };
      return state;
    }
    if (event === "game:join" || event === "game:sync") return state;
    return {};
  });
  createRealtime.mockReturnValue({ socket, send });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/home"]}>
        <RuntimeProvider>
          <Harness />
        </RuntimeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("connected");
  fireEvent.click(screen.getByText("join"));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith("game:join", {
      tournamentId: "t",
      matchId: "m",
    }),
  );
  await waitFor(() =>
    expect(sessionStorage.getItem("chess:participation:p")).toContain("m"),
  );
  await screen.findByText("ready");
  fireEvent.click(screen.getByText("move"));
  await screen.findByText("unresolved");
  await waitFor(() => expect(commands).toHaveLength(1));
  fireEvent.click(screen.getByText("retry"));
  await screen.findByText("resolved");
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  expect(screen.getByText("sequence 1")).toBeInTheDocument();
  view.unmount();
  client.clear();
});
