import React, { useEffect, useState } from "react";
import { Box, Typography, Button, Avatar, IconButton } from "@mui/material";
import { useNavigate } from "react-router-dom";
import {
  createNewGame,
  disconnect,
  initSocket,
  logout,
} from "../../services/Controller";
import { useLogin } from "../auth/LoginProvider";
import LoaderText from "../../components/LoaderText";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import NorthEastIcon from "@mui/icons-material/NorthEast";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";

const IVORY = "#F4F0E6";
const GOLD = "#C7A45A";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const MUTED = "rgba(244, 240, 230, 0.62)";
const FAINT = "rgba(244, 240, 230, 0.45)";
const BORDER = "rgba(244, 240, 230, 0.09)";
const PANEL = "rgba(244, 240, 230, 0.03)";
const TEAL = "#8FB3A6";

const player = {
  name: "",
  initials: "",
  matches: 0,
  rating: "1,842",
};

const games = [
  {
    tournament: "Autumn Masters",
    opponent: "Mira Shah",
    color: "White",
    timing: "10 + 0",
    won: true,
    change: 18,
  },
  {
    tournament: "City Open · R4",
    opponent: "Dev Patel",
    color: "Black",
    timing: "15 + 10",
    won: false,
    change: 7,
  },
  {
    tournament: "Midnight Cup",
    opponent: "Sana Iyer",
    color: "White",
    timing: "5 + 3",
    won: true,
    change: 12,
  },
  {
    tournament: "Winter Classic",
    opponent: "Arjun Rao",
    color: "Black",
    timing: "10 + 5",
    won: true,
    change: 9,
  },
  {
    tournament: "Rapid Arena",
    opponent: "Leah Thomas",
    color: "White",
    timing: "3 + 2",
    won: false,
    change: 5,
  },
];

const navItems = [
  { label: "Home", icon: HomeOutlinedIcon },
  { label: "Tournaments", icon: () => <span style={{ fontSize: 18 }}>♜</span> },
  { label: "Settings", icon: SettingsOutlinedIcon },
  { label: "Profile", icon: () => <span style={{ fontSize: 18 }}>♗</span> },
  { label: "Logout", icon: LogoutOutlinedIcon },
];

const headerCell = {
  fontFamily: SANS,
  fontSize: 10.5,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: FAINT,
  fontWeight: 500,
};

function Sidebar({ collapsed, onToggle, onLogout }) {
  return (
    <Box
      component="aside"
      sx={{
        width: collapsed ? 76 : 232,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: `1px solid ${BORDER}`,
        background: "rgba(8, 13, 18, 0.55)",
        transition: "width 0.2s ease",
        minHeight: "100vh",
      }}
    >
      {/* Logo */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 3.5,
          pt: 3.5,
          pb: 4,
        }}
      >
        <Box sx={{ color: GOLD, fontSize: 26, lineHeight: 1 }}>♞</Box>
        {!collapsed && (
          <Typography
            sx={{
              fontFamily: SERIF,
              fontSize: 19,
              fontWeight: 600,
              color: IVORY,
            }}
          >
            Chess <span style={{ color: GOLD }}>Olympics</span>
          </Typography>
        )}
      </Box>

      {!collapsed && (
        <Typography
          sx={{
            fontFamily: SANS,
            fontSize: 10.5,
            letterSpacing: "0.16em",
            color: TEAL,
            opacity: 0.8,
            px: 3.75,
            mb: 1.5,
          }}
        >
          YOUR GAME
        </Typography>
      )}

      {/* Nav */}
      <Box
        sx={{ px: 2.25, display: "flex", flexDirection: "column", gap: 0.75 }}
      >
        {navItems.map((item, i) => {
          const active = i === 0;
          const Icon = item.icon;
          return (
            <Box
              key={item.label}
              onClick={item.label === "Logout" ? onLogout : undefined}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.75,
                px: 2,
                py: 1.5,
                borderRadius: "10px",
                cursor: "pointer",
                color: active ? IVORY : MUTED,
                background: active
                  ? "linear-gradient(90deg, rgba(199,164,90,0.16), rgba(199,164,90,0.04))"
                  : "transparent",
                borderLeft: active
                  ? `2px solid ${GOLD}`
                  : "2px solid transparent",
                "&:hover": { background: "rgba(244,240,230,0.05)" },
              }}
            >
              <Box sx={{ color: GOLD, display: "flex", alignItems: "center" }}>
                <Icon sx={{ fontSize: 18 }} />
              </Box>
              {!collapsed && (
                <Typography
                  sx={{
                    fontFamily: SANS,
                    fontSize: 14.5,
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {item.label}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>

      <Box sx={{ flex: 1 }} />

      {/* Collapse */}
      <Box sx={{ mx: 2.25, borderTop: `1px solid ${BORDER}` }} />
      <Box
        onClick={onToggle}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 3,
          py: 3.25,
          cursor: "pointer",
          color: MUTED,
          "&:hover": { color: IVORY },
        }}
      >
        {collapsed ? (
          <ChevronRightIcon sx={{ fontSize: 18, color: GOLD }} />
        ) : (
          <ChevronLeftIcon sx={{ fontSize: 18, color: GOLD }} />
        )}
        {!collapsed && (
          <Typography sx={{ fontFamily: SANS, fontSize: 15 }}>
            Collapse menu
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function StatCard({ label, value, caption, serif = true, accent }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        p: 2.5,
        borderRadius: "14px",
        border: `1px solid ${BORDER}`,
        background:
          "linear-gradient(160deg, rgba(244,240,230,0.05), rgba(244,240,230,0.015))",
      }}
    >
      <Typography
        sx={{ fontFamily: SANS, fontSize: 12.5, color: MUTED, mb: 0.75 }}
      >
        {label}
      </Typography>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
        }}
      >
        <Typography
          sx={{
            fontFamily: SERIF,
            fontSize: serif ? 26 : 28,
            fontWeight: 600,
            color: IVORY,
            lineHeight: 1.2,
          }}
        >
          {value}
          {accent && (
            <span style={{ color: GOLD, fontSize: 16, marginLeft: 8 }}>✦</span>
          )}
        </Typography>
        <Typography
          sx={{ fontFamily: SANS, fontSize: 11.5, color: FAINT, pb: 0.5 }}
        >
          {caption}
        </Typography>
      </Box>
    </Box>
  );
}

function ResultPill({ won }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        px: 1.5,
        py: 0.4,
        borderRadius: "999px",
        fontFamily: SANS,
        fontSize: 11.5,
        color: won ? "#9CC9A8" : "#D9A19A",
        background: won ? "rgba(76, 140, 98, 0.18)" : "rgba(170, 80, 70, 0.18)",
      }}
    >
      {won ? "Won" : "Lost"}
    </Box>
  );
}

export default function NewGame({ name }) {
  const nav = useNavigate();
  const { setPlayer1, setPlayer2, changeGameFlag } = useLogin();
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState("");
  const [loader, setLoader] = useState(false);
  player.name = name;
  player.initials = name[0].toUpperCase();

  const onNewGame = () => {
    setStatus("Created New Game, Searching for another Player...");
    setLoader(true);
    createNewGame(name, (player1, player2) => {
      setPlayer1(player1);
      setPlayer2(player2);
      changeGameFlag();
      nav(`/game`);
    });
  };

  const onLogout = () => {
    setStatus("Loggin Out...");
    setLoader(true);
    disconnect();
    logout(() => nav(`/login`, { replace: true }));
  };

  useEffect(() => {
    initSocket();
  }, []);

  if (loader) return <LoaderText text={status} />;

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", color: IVORY }}>
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onLogout={onLogout}
      />

      <Box sx={{ flex: 1, minWidth: 0, px: 4, pt: 3.5, pb: 6 }}>
        {/* Top bar */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 3.5,
          }}
        >
          <Typography
            sx={{
              fontFamily: SANS,
              fontSize: 11.5,
              letterSpacing: "0.14em",
              color: TEAL,
              opacity: 0.85,
            }}
          >
            PLAYER HOME &nbsp;/&nbsp; OVERVIEW
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <IconButton
              size="small"
              sx={{
                width: 34,
                height: 34,
                color: GOLD,
                border: `1px solid ${BORDER}`,
                background: PANEL,
                fontSize: 14,
              }}
            >
              ♤
            </IconButton>
            <Avatar
              sx={{
                width: 34,
                height: 34,
                fontFamily: SERIF,
                fontSize: 13,
                fontWeight: 700,
                color: IVORY,
                bgcolor: "rgba(199,164,90,0.22)",
                border: `1px solid rgba(199,164,90,0.5)`,
              }}
            >
              {player.initials}
            </Avatar>
          </Box>
        </Box>

        <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
          {/* Left / main column */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                mb: 3,
              }}
            >
              <Typography
                sx={{
                  fontFamily: SERIF,
                  fontSize: 32,
                  fontWeight: 500,
                  color: IVORY,
                }}
              >
                Welcome back, {player.name}
              </Typography>
              <Typography
                sx={{
                  fontFamily: SANS,
                  fontSize: 12.5,
                  color: TEAL,
                  opacity: 0.85,
                }}
              >
                Your season at a glance
              </Typography>
            </Box>

            {/* Stat cards */}
            <Box sx={{ display: "flex", gap: 1.75, mb: 4.5 }}>
              <StatCard label="Player" value={player.name} caption="Member" />
              <StatCard
                label="Matches played"
                value={player.matches}
                caption="This season"
                serif={false}
              />
              <StatCard
                label="Current rating"
                value={player.rating}
                caption="Rapid"
                serif={false}
                accent
              />
            </Box>

            {/* Recent games */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                mb: 1.75,
              }}
            >
              <Typography
                sx={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500 }}
              >
                Recent games
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  color: GOLD,
                  cursor: "pointer",
                  fontFamily: SANS,
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                View all <NorthEastIcon sx={{ fontSize: 12 }} />
              </Box>
            </Box>

            <Box
              sx={{
                borderRadius: "14px",
                border: `1px solid ${BORDER}`,
                background: "rgba(8, 13, 18, 0.45)",
                overflow: "hidden",
              }}
            >
              {/* Header */}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "1.6fr 1.3fr 1.2fr 1fr 1fr 1fr",
                  alignItems: "center",
                  px: 1.5,
                  height: 50,
                  borderBottom: `1px solid ${BORDER}`,
                }}
              >
                {[
                  "Tournament name",
                  "Opponent",
                  "Piece color",
                  "Timing",
                  "Win status",
                  "Rating change",
                ].map((h) => (
                  <Typography key={h} sx={headerCell}>
                    {h}
                  </Typography>
                ))}
              </Box>

              {/* Rows */}
              {games.map((g, i) => (
                <Box
                  key={g.tournament}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "1.6fr 1.3fr 1.2fr 1fr 1fr 1fr",
                    alignItems: "center",
                    px: 1.5,
                    height: 52,
                    borderBottom:
                      i === games.length - 1 ? "none" : `1px solid ${BORDER}`,
                    "&:hover": { background: "rgba(244,240,230,0.025)" },
                  }}
                >
                  <Typography
                    sx={{ fontFamily: SERIF, fontSize: 12.5, fontWeight: 700 }}
                  >
                    {g.tournament}
                  </Typography>
                  <Typography
                    sx={{ fontFamily: SANS, fontSize: 12.5, color: MUTED }}
                  >
                    {g.opponent}
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      sx={{
                        fontSize: 17,
                        lineHeight: 1,
                        color: g.color === "White" ? "#E9D9D9" : "#6F8A86",
                      }}
                    >
                      {g.color === "White" ? "♔" : "♚"}
                    </Box>
                    <Typography
                      sx={{ fontFamily: SANS, fontSize: 12.5, color: IVORY }}
                    >
                      {g.color}
                    </Typography>
                  </Box>
                  <Typography
                    sx={{ fontFamily: SANS, fontSize: 12.5, color: MUTED }}
                  >
                    {g.timing}
                  </Typography>
                  <Box>
                    <ResultPill won={g.won} />
                  </Box>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      color: MUTED,
                    }}
                  >
                    {g.won ? (
                      <ArrowUpwardIcon sx={{ fontSize: 12 }} />
                    ) : (
                      <ArrowDownwardIcon sx={{ fontSize: 12 }} />
                    )}
                    <Typography
                      sx={{ fontFamily: SANS, fontSize: 12.5, color: MUTED }}
                    >
                      {g.change}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
          {/* Right column */}
          <Box sx={{ width: 264, flexShrink: 0 }}>
            <Box
              sx={{
                p: 2.75,
                borderRadius: "16px",
                border: `1px solid ${BORDER}`,
                background:
                  "linear-gradient(160deg, rgba(244,240,230,0.06), rgba(244,240,230,0.015))",
                boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
              }}
            >
              <Typography
                sx={{
                  fontFamily: SANS,
                  fontSize: 10.5,
                  letterSpacing: "0.16em",
                  color: GOLD,
                  mb: 1.5,
                }}
              >
                READY WHEN YOU ARE
              </Typography>
              <Typography
                sx={{
                  fontFamily: SERIF,
                  fontSize: 28,
                  fontWeight: 500,
                  mb: 1.25,
                }}
              >
                Quick play
              </Typography>
              <Typography
                sx={{
                  fontFamily: SANS,
                  fontSize: 12.5,
                  color: MUTED,
                  lineHeight: 1.6,
                  mb: 2.5,
                }}
              >
                Find your next match and take your seat at the board.
              </Typography>
              <Button
                fullWidth
                endIcon={<ArrowForwardIcon sx={{ fontSize: 15 }} />}
                onClick={onNewGame}
                sx={{
                  py: 1.3,
                  borderRadius: "8px",
                  textTransform: "none",
                  fontFamily: SANS,
                  fontSize: 13.5,
                  fontWeight: 500,
                  color: "#101820",
                  backgroundColor: GOLD,
                  "&:hover": { backgroundColor: "#D3B26A" },
                }}
              >
                Play a game
              </Button>
              <Typography
                sx={{
                  fontFamily: SANS,
                  fontSize: 11,
                  color: FAINT,
                  textAlign: "center",
                  mt: 1.75,
                }}
              >
                Matchmaking usually takes a moment
              </Typography>
            </Box>

            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                mt: 2.5,
                ml: 0.5,
              }}
            >
              <Box
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  bgcolor: "#8FC9A0",
                }}
              />
              <Typography sx={{ fontFamily: SANS, fontSize: 11, color: MUTED }}>
                Players are online
              </Typography>
            </Box>

            <Box
              sx={{
                mt: 2.5,
                ml: 0.5,
                pl: 2,
                py: 0.5,
                borderLeft: `1px solid ${BORDER}`,
              }}
            >
              <Typography
                sx={{
                  fontFamily: SANS,
                  fontSize: 11,
                  color: FAINT,
                  lineHeight: 1.7,
                }}
              >
                A considered move can change everything. Your next game starts
                here.
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
