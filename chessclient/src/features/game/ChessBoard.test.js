import { render, screen, fireEvent } from "@testing-library/react";
import ChessBoard from "./ChessBoard";
const board = Array.from({ length: 8 }, () => Array(8).fill(" "));
board[6][4] = "♙";
test("selection submits engine coordinates and clears after a confirmed move", () => {
  const onMove = jest.fn(),
    { rerender } = render(
      <ChessBoard board={board} side="white" onMove={onMove} />,
    );
  fireEvent.click(screen.getByRole("button", { name: "e2, white pawn" }));
  expect(
    screen.getByRole("button", { name: "e2, white pawn" }),
  ).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "e4, empty" }));
  expect(onMove).toHaveBeenCalledWith({ row: 1, col: 4 }, { row: 3, col: 4 });
  rerender(
    <ChessBoard board={board} side="white" onMove={onMove} sequence={1} />,
  );
  expect(
    screen.getByRole("button", { name: "e2, white pawn" }),
  ).toHaveAttribute("aria-pressed", "false");
});
test("disabled board never submits a move and supports keyboard navigation", () => {
  const onMove = jest.fn();
  render(<ChessBoard board={board} disabled onMove={onMove} />);
  const square = screen.getByRole("button", { name: "e2, white pawn" });
  square.focus();
  fireEvent.keyDown(square, { key: "ArrowRight" });
  expect(screen.getByRole("button", { name: "f2, empty" })).toHaveFocus();
  fireEvent.click(square);
  fireEvent.click(screen.getByRole("button", { name: "e4, empty" }));
  expect(onMove).not.toHaveBeenCalled();
});
