import { acceptSnapshot, coordinates, remaining } from "./model";
test("board orientation always maps to engine coordinates", () => {
  expect(coordinates(6, 4, "white")).toEqual({ row: 1, col: 4 });
  expect(coordinates(1, 3, "black")).toEqual({ row: 1, col: 4 });
  expect(coordinates(0, 0, "white")).toEqual({ row: 7, col: 0 });
  expect(coordinates(0, 0, "black")).toEqual({ row: 0, col: 7 });
});
test("stale receipts cannot overwrite newer game snapshots or remove a final result", () => {
  const current = {
    matchId: "m",
    revision: 5,
    moveSequence: 2,
    result: { outcome: "DRAW" },
  };
  expect(
    acceptSnapshot(current, { matchId: "m", revision: 4, moveSequence: 1 }),
  ).toBe(current);
  expect(
    acceptSnapshot(current, {
      matchId: "m",
      revision: 6,
      moveSequence: 2,
      result: null,
    }),
  ).toBe(current);
  const newer = {
    matchId: "m",
    revision: 6,
    moveSequence: 2,
    result: current.result,
  };
  expect(acceptSnapshot(current, newer)).toBe(newer);
});
test("countdowns use absolute server deadlines and monotonic elapsed time", () => {
  expect(remaining(10000, { serverNow: 4000, monotonic: 200 }, 1200)).toBe(
    5000,
  );
  expect(remaining(10000, { serverNow: 4000, monotonic: 200 }, 9000)).toBe(0);
});
