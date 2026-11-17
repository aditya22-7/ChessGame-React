import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BoardSet from "./BoardSet";
import { useLogin } from "../auth/LoginProvider";
import Status from "./Status";
import { leaveGame } from "../../services/Controller";
import LoaderText from "../../components/LoaderText";

/* ---------- design tokens ---------- */
const IVORY = "#F4F0E6";
const GOLD = "#C7A45A";
const SANS = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace";
const MUTED = "rgba(244, 240, 230, 0.6)";
const FAINT = "rgba(244, 240, 230, 0.4)";
const BORDER = "rgba(244, 240, 230, 0.1)";
const CARD = "#172027";

/* ---------- static placeholder data (view only for now) ---------- */
const STATIC_MOVES = [
	["01", "e4", "e5"],
	["02", "Nf3", "Nc6"],
	["03", "Bb5", "a6"],
	["04", "Ba4", "Nf6"],
	["05", "O-O", "Be7"],
	["06", "Re1", "b5"],
];
const PANEL_ACTIONS = ["New game", "Flip", "Draw", "Resign"];

/* ---------- styles ---------- */
const css = `
.gm-board-wrap > :first-child { display: none; }

/* Make the chess board bigger (scales squares, pieces and coordinates together) */
.gm-board-wrap { zoom: 1.3; }

.gm-btn { transition: background-color .15s ease; }
.gm-btn:hover { background-color: rgba(244,240,230,0.1) !important; }
.gm-back:hover { background-color: rgba(199,164,90,0.14) !important; }
.gm-quit { transition: background-color .15s ease; }
.gm-quit:hover { background-color: #D3B26A !important; }

/* Scale the whole layout down on shorter laptop screens so it fits without scrolling */
@media (max-height: 860px) { .gm-content { zoom: 0.92; } }
@media (max-height: 780px) { .gm-content { zoom: 0.84; } }
@media (max-height: 700px) { .gm-content { zoom: 0.76; } }
@media (max-height: 620px) { .gm-content { zoom: 0.68; } }

/* Stack the columns on narrow screens */
@media (max-width: 820px) {
	.gm-content { flex-direction: column; align-items: center; }
	.gm-side { width: 100% !important; max-width: 480px; }
}
`;

const sectionLabel = {
	fontFamily: SANS,
	fontSize: 11,
	letterSpacing: "0.16em",
	textTransform: "uppercase",
	color: GOLD,
	fontWeight: 600,
	margin: 0,
};

/* ---------- inline SVG icons ---------- */
const BackIcon = () => (
	<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
		<path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
	</svg>
);
const PersonIcon = () => (
	<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
		<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
	</svg>
);

/* ---------- small presentational pieces ---------- */
function PlayerCard({ name, rating, time, active }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				padding: "10px 16px",
				borderRadius: 12,
				border: `1px solid ${BORDER}`,
				backgroundColor: CARD,
			}}>
			<div>
				<div style={{ display: "flex", alignItems: "center", gap: 6, color: IVORY }}>
					<PersonIcon />
					<span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600 }}>
						{name}
					</span>
				</div>
				<div
					style={{ fontFamily: SANS, fontSize: 11.5, color: MUTED, marginTop: 3 }}>
					Rating {rating}
				</div>
			</div>
			<div
				style={{
					padding: "6px 14px",
					borderRadius: 8,
					fontFamily: MONO,
					fontSize: 18,
					fontWeight: 500,
					letterSpacing: "0.04em",
					color: active ? "#172027" : GOLD,
					backgroundColor: active ? GOLD : "rgba(244, 240, 230, 0.05)",
					border: active ? "1px solid transparent" : `1px solid ${BORDER}`,
				}}>
				{time}
			</div>
		</div>
	);
}

function MovesPanel({ onQuit }) {
	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				boxSizing: "border-box",
				padding: 18,
				borderRadius: 12,
				border: `1px solid ${BORDER}`,
				backgroundColor: CARD,
			}}>
			{/* Live game status (e.g. "Waiting for <player> to make a move..") */}
			<div
				style={{
					paddingBottom: 14,
					marginBottom: 16,
					borderBottom: `1px solid ${BORDER}`,
				}}>
				<Status />
			</div>

			<p style={{ ...sectionLabel, marginBottom: 16 }}>Moves</p>

			<div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
				{STATIC_MOVES.map(([no, w, b]) => (
					<div
						key={no}
						style={{
							display: "grid",
							gridTemplateColumns: "28px 1fr 1fr",
							fontFamily: MONO,
							fontSize: 12,
						}}>
						<span style={{ color: FAINT }}>{no}</span>
						<span style={{ color: IVORY, fontWeight: 600 }}>{w}</span>
						<span style={{ color: IVORY, fontWeight: 600 }}>{b}</span>
					</div>
				))}
			</div>

			<p style={{ ...sectionLabel, marginTop: 26, marginBottom: 12 }}>Captured</p>
			<div style={{ display: "flex", gap: 8, fontSize: 18, color: IVORY, marginBottom: 18 }}>
				<span>♟</span>
				<span>♞</span>
			</div>

			<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
				{PANEL_ACTIONS.map((label) => (
					<button
						key={label}
						type="button"
						className="gm-btn"
						style={{
							padding: "5px 12px",
							borderRadius: 7,
							fontFamily: SANS,
							fontSize: 11.5,
							color: IVORY,
							cursor: "pointer",
							border: `1px solid ${BORDER}`,
							backgroundColor: "rgba(244, 240, 230, 0.03)",
						}}>
						{label}
					</button>
				))}
			</div>

			{/* Quit – pinned to the bottom of the panel */}
			<button
				type="button"
				className="gm-quit"
				onClick={onQuit}
				style={{
					marginTop: "auto",
					width: "100%",
					padding: "11px 0",
					borderRadius: 8,
					border: "none",
					cursor: "pointer",
					fontFamily: SANS,
					fontSize: 14,
					fontWeight: 600,
					color: "#101820",
					backgroundColor: GOLD,
				}}>
				Quit
			</button>
		</div>
	);
}

/* ---------- page ---------- */
export default function Game() {
	const nav = useNavigate();
	const [status, setStatus] = useState("");
	const [loader, setLoader] = useState(false);
	const { player1, player2, setPlayer2, changeGameFlag } = useLogin();
	const leavingRef = useRef(false);

	const leaveCurrentGame = (navigateToLobby) => {
		if (leavingRef.current) return;
		leavingRef.current = true;
		setStatus("Leaving Game..");
		setLoader(true);
		changeGameFlag();
		leaveGame(() => {
			setPlayer2("");
			if (navigateToLobby) nav(`/newgame`, { replace: true });
		});
	};

	useEffect(() => {
		const handleBrowserBack = () => leaveCurrentGame(false);
		window.addEventListener("popstate", handleBrowserBack);
		return () => window.removeEventListener("popstate", handleBrowserBack);
	}, []);

	if (loader) return <LoaderText text={status} />;

	return (
		<div
			style={{
				position: "relative",
				minHeight: "100vh",
				boxSizing: "border-box",
				padding: "16px 24px",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				color: IVORY,
			}}>
			<style>{css}</style>

			{/* Back arrow – pinned to the top-left corner, leaves the game */}
			<button
				type="button"
				aria-label="Leave game"
				title="Leave game"
				className="gm-back"
				onClick={() => leaveCurrentGame(true)}
				style={{
					position: "absolute",
					top: 20,
					left: 24,
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: 38,
					height: 38,
					padding: 0,
					borderRadius: "50%",
					cursor: "pointer",
					color: GOLD,
					border: `1px solid ${BORDER}`,
					backgroundColor: "rgba(244, 240, 230, 0.04)",
				}}>
				<BackIcon />
			</button>

			<div
				className="gm-content"
				style={{
					display: "flex",
					alignItems: "stretch",
					justifyContent: "center",
					gap: 24,
				}}>
				{/* Left: opponent, board, you */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 10,
						width: "fit-content",
					}}>
					<PlayerCard name={player2} rating={1428} time="08:42" active={false} />

					{/* BoardSet renders a "p1 VS p2" title first - hidden here because
					    the player cards already show both names. */}
					<div className="gm-board-wrap">
						<BoardSet />
					</div>

					<PlayerCard name={player1} rating={1512} time="09:16" active />
				</div>

				{/* Right: moves panel + leave */}
				<div
					className="gm-side"
					style={{
						width: 250,
						display: "flex",
						flexDirection: "column",
					}}>
					<MovesPanel onQuit={() => leaveCurrentGame(true)} />
				</div>
			</div>
		</div>
	);
}
