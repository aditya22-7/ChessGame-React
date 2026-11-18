import { useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { coordinates } from "../tournaments/model";
const white = "♔♕♖♗♘♙",
  black = "♚♛♜♝♞♟";
const names = {
  "♔": "white king",
  "♕": "white queen",
  "♖": "white rook",
  "♗": "white bishop",
  "♘": "white knight",
  "♙": "white pawn",
  "♚": "black king",
  "♛": "black queen",
  "♜": "black rook",
  "♝": "black bishop",
  "♞": "black knight",
  "♟": "black pawn",
};
export default function ChessBoard({
  board,
  side = "white",
  disabled = false,
  onMove,
  sequence = 0,
}) {
  const [selected, setSelected] = useState(null),
    [flipped, setFlipped] = useState(false);
  useEffect(() => setSelected(null), [sequence, disabled]);
  const orientation = flipped ? (side === "white" ? "black" : "white") : side;
  const click = (p, piece) => {
    if (disabled) return;
    const own =
      (side === "white" ? white : black).includes(piece) &&
      Boolean(piece?.trim());
    if (
      selected &&
      !(selected.row === p.row && selected.col === p.col) &&
      !own
    ) {
      const from = selected;
      setSelected(null);
      onMove(from, p);
    } else setSelected(own ? p : null);
  };
  const keyDown = (e) => {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 };
    if (offsets[e.key] !== undefined) {
      e.preventDefault();
      const buttons = [...e.currentTarget.querySelectorAll("[data-square]")],
        index = buttons.indexOf(document.activeElement);
      buttons[Math.max(0, Math.min(63, index + offsets[e.key]))]?.focus();
    }
    if (e.key === "Escape") setSelected(null);
  };
  return (
    <Box>
      <Box
        onKeyDown={keyDown}
        role="group"
        aria-label="Chess board; use arrow keys to navigate and Enter to select"
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(8,1fr)",
          width: "100%",
          maxWidth: 640,
          aspectRatio: "1",
          border: "3px solid #C7A45A",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        {Array.from({ length: 64 }, (_, i) => {
          const row = Math.floor(i / 8),
            col = i % 8,
            p = coordinates(row, col, orientation),
            piece = board?.[7 - p.row]?.[p.col] || "",
            square = String.fromCharCode(97 + p.col) + (p.row + 1),
            chosen = selected?.row === p.row && selected?.col === p.col;
          return (
            <Box
              component="button"
              type="button"
              data-square={square}
              key={square}
              aria-label={`${square}, ${names[piece] || "empty"}`}
              aria-pressed={chosen}
              aria-disabled={disabled}
              onClick={() => click(p, piece)}
              sx={{
                position: "relative",
                border: 0,
                borderRadius: 0,
                p: 0,
                aspectRatio: "1",
                cursor: disabled ? "default" : "pointer",
                background: chosen
                  ? "#C7A45A"
                  : (row + col) % 2
                    ? "#668378"
                    : "#E4DECC",
                color: white.includes(piece) ? "#fffaf0" : "#14202A",
                textShadow: white.includes(piece)
                  ? "0 1px 2px #14202A"
                  : "none",
                fontFamily: "Georgia, serif",
                fontSize: "clamp(24px,6vw,52px)",
                lineHeight: 1,
                "&:focus-visible": {
                  outline: "3px solid #D6A63D",
                  outlineOffset: -4,
                  zIndex: 1,
                },
              }}
            >
              {piece}
              {col === 0 && (
                <Box
                  component="span"
                  sx={{
                    position: "absolute",
                    top: 2,
                    left: 3,
                    fontSize: 10,
                    color: "#14202A",
                    textShadow: "none",
                  }}
                >
                  {p.row + 1}
                </Box>
              )}
              {row === 7 && (
                <Box
                  component="span"
                  sx={{
                    position: "absolute",
                    bottom: 2,
                    right: 3,
                    fontSize: 10,
                    color: "#14202A",
                    textShadow: "none",
                  }}
                >
                  {square[0]}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      <Button
        onClick={() => {
          setFlipped((v) => !v);
          setSelected(null);
        }}
      >
        Flip board
      </Button>
      <Typography variant="caption" color="text.secondary">
        Select a piece, then a destination. The server validates every move.
      </Typography>
    </Box>
  );
}
