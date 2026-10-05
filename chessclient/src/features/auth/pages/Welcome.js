import React from "react";
import { Box, Button, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";

// Midnight Atelier palette
const NAVY = "#101820";
const IVORY = "#F4F0E6";
const GOLD = "#C7A45A";

const SERIF = '"Playfair Display", Georgia, "Times New Roman", serif';
const SANS = '"Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export default function Welcome() {
  const nav = useNavigate();

  const onContinue = () => {
    nav("/login");
  };

  return (
    <Box
      sx={{
        width: "100%",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        color: IVORY,
        position: "relative",
      }}
    >
      {/* Top bar: Sign in on the top right */}
      <Box
        component="header"
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          px: { xs: 2.5, sm: 5 },
          py: { xs: 2, sm: 3 },
        }}
      >
        <Button
          onClick={onContinue}
          disableRipple
          sx={{
            color: IVORY,
            fontFamily: SANS,
            fontSize: "1rem",
            textTransform: "none",
            borderRadius: 0,
            px: 0.5,
            pb: 0.25,
            borderBottom: `1px solid ${GOLD}`,
            "&:hover": {
              backgroundColor: "transparent",
              color: GOLD,
            },
            "&.Mui-focusVisible": {
              outline: `2px solid ${GOLD}`,
              outlineOffset: 4,
            },
          }}
        >
          Sign in
        </Button>
      </Box>

      {/* Centered content */}
      <Box
        component="main"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          px: 3,
          pb: { xs: 8, sm: 10 },

          // Negative values move the content upward.
          transform: {
            xs: "translateY(-12px)",
            sm: "translateY(-20px)",
          },
        }}
      >
        <Typography
          component="h1"
          sx={{
            fontFamily: SERIF,
            fontWeight: 500,
            color: IVORY,
            fontSize: { xs: "2.75rem", sm: "4.25rem", md: "5.5rem" },
            lineHeight: 1.05,
            letterSpacing: "-0.01em",
          }}
        >
          Chess Olympics
        </Typography>

        <Typography
          sx={{
            mt: { xs: 2.5, sm: 3 },
            maxWidth: 520,
            fontFamily: SERIF,
            fontStyle: "italic",
            color: "rgba(244, 240, 230, 0.78)",
            fontSize: { xs: "1.2rem", sm: "1.6rem" },
            lineHeight: 1.5,
          }}
        >
          Every move opens a new possibility.
        </Typography>

        <Button
          onClick={onContinue}
          variant="contained"
          disableElevation
          sx={{
            mt: { xs: 5, sm: 6 },
            px: 5,
            py: 1.4,
            fontFamily: SANS,
            fontSize: "1.05rem",
            fontWeight: 600,
            textTransform: "none",
            borderRadius: "4px",
            color: NAVY,
            backgroundColor: GOLD,
            "&:hover": {
              backgroundColor: "#D4B36C",
            },
            "&.Mui-focusVisible": {
              outline: `2px solid ${IVORY}`,
              outlineOffset: 3,
            },
          }}
        >
          Sign in
        </Button>
      </Box>
    </Box>
  );
}
