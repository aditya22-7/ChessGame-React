import { Box } from "@mui/material";

const NAVY = "#101820";

export default function PageBackground({ children, sx = {} }) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        width: "100%",
        color: "#F4F0E6",
        overflow: "hidden",
        backgroundColor: NAVY,
        backgroundImage: `
          radial-gradient(
            ellipse 70% 85% at 80% 45%,
            rgba(25, 43, 38, 0.72) 0%,
            rgba(25, 43, 38, 0.38) 38%,
            transparent 75%
          ),
          radial-gradient(
            ellipse 35% 30% at 76% 24%,
            rgba(244, 240, 230, 0.04) 0%,
            transparent 75%
          ),
          linear-gradient(
            135deg,
            #101820 0%,
            #111B22 100%
          )
        `,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}